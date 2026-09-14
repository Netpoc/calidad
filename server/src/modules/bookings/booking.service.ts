import { Types } from 'mongoose'
import { BranchModel } from '../branches/branch.model.js'
import { CustomerModel } from '../customers/customer.model.js'
import { findOrCreateByPhone } from '../customers/customer.service.js'
import { PriceItemModel } from '../pricing/price-item.model.js'
import {
  bookingConfirmedMessage,
  readyForCollectionMessage,
  sendSms,
} from '../notifications/sms.service.js'
import { canTransition, type BookingStatus, type ServiceTier } from '../../shared/domain.js'
import { HttpError } from '../../shared/http-error.js'
import { BookingModel, type BookingDoc } from './booking.model.js'

export interface BookingItemInput {
  priceItemId: string
  tier: ServiceTier
  quantity: number
}

export interface CreateBookingInput {
  branchId: string
  createdByUserId: string
  customer: { name: string; phone: string; email?: string; address?: string }
  items: BookingItemInput[]
  discountMinor?: number
  paidMinor?: number
  expectedReadyAt?: Date
  /** Idempotency key from the client; required for offline-replayed bookings. */
  clientRequestId?: string
  syncedFromOffline?: boolean
}

/**
 * Registers a customer's laundry each-by-each and returns the booking.
 *
 * Prices are resolved server-side from the price list rather than trusted from
 * the client, then snapshotted onto the booking so a later price change by the
 * owner does not rewrite history. Offline clients therefore compute a
 * *provisional* total for display; the server total is authoritative on sync.
 */
export async function createBooking(input: CreateBookingInput): Promise<{
  booking: BookingDoc
  customerCreated: boolean
  replayed: boolean
}> {
  if (input.clientRequestId) {
    const existing = await BookingModel.findOne({ clientRequestId: input.clientRequestId })
    if (existing) {
      // A replayed offline booking. Return the original rather than creating a
      // duplicate — and note that no SMS is re-sent.
      return { booking: existing, customerCreated: false, replayed: true }
    }
  }

  const branch = await BranchModel.findById(input.branchId)
  if (!branch || !branch.active) {
    throw new HttpError(404, 'Branch not found or inactive')
  }

  if (input.items.length === 0) {
    throw new HttpError(400, 'A booking must contain at least one item')
  }

  const { customer, created } = await findOrCreateByPhone({
    ...input.customer,
    homeBranchId: input.branchId,
  })

  const items = await priceItems(input.items, input.branchId)

  const booking = await createWithUniqueReference({
    branchId: new Types.ObjectId(input.branchId),
    customerId: customer._id,
    createdByUserId: new Types.ObjectId(input.createdByUserId),
    items,
    discountMinor: input.discountMinor ?? 0,
    paidMinor: input.paidMinor ?? 0,
    expectedReadyAt: input.expectedReadyAt,
    status: 'received',
    statusHistory: [
      { status: 'received', at: new Date(), byUserId: new Types.ObjectId(input.createdByUserId) },
    ],
    clientRequestId: input.clientRequestId ?? null,
    syncedFromOffline: input.syncedFromOffline ?? false,
  })

  await sendSms({
    to: customer.phone,
    message: bookingConfirmedMessage({
      customerName: customer.name,
      referenceCode: booking.referenceCode,
      totalMinor: booking.totalMinor,
      branchName: branch.name,
    }),
    dedupeKey: `booking:${booking._id.toString()}:confirmed`,
    bookingId: booking._id.toString(),
  })

  return { booking, customerCreated: created, replayed: false }
}

/**
 * Resolves each line against the price list, rejecting tiers an item does not
 * offer — a missing tier price means "not offered", not free (CLAUDE.md).
 */
async function priceItems(inputs: BookingItemInput[], branchId: string) {
  const ids = inputs.map((item) => item.priceItemId)
  const priceItems = await PriceItemModel.find({
    _id: { $in: ids },
    active: true,
    $or: [{ branchId: null }, { branchId }],
  })

  const byId = new Map(priceItems.map((item) => [item._id.toString(), item]))

  return inputs.map((input) => {
    const priceItem = byId.get(input.priceItemId)
    if (!priceItem) {
      throw new HttpError(400, `Unknown or inactive price item: ${input.priceItemId}`)
    }

    const unitPriceMinor =
      input.tier === 'wash_starch_iron'
        ? priceItem.washStarchIronMinor
        : priceItem.starchIronMinor

    if (unitPriceMinor == null) {
      throw new HttpError(
        400,
        `"${priceItem.name}" is not offered as ${input.tier.replace(/_/g, ' ')}`,
      )
    }

    if (!Number.isInteger(input.quantity) || input.quantity < 1) {
      throw new HttpError(400, `Invalid quantity for "${priceItem.name}"`)
    }

    return {
      priceItemId: priceItem._id,
      name: priceItem.name,
      tier: input.tier,
      quantity: input.quantity,
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor * input.quantity,
    }
  })
}

/**
 * Reference codes are random, so a collision is possible if unlikely. The
 * unique index is the real guarantee; this retries rather than surfacing a
 * duplicate-key error to a staff member mid-booking.
 */
async function createWithUniqueReference(
  doc: Record<string, unknown>,
  attempts = 5,
): Promise<BookingDoc> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await BookingModel.create(doc)
    } catch (error) {
      const duplicate =
        typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000
      const onReference =
        duplicate &&
        JSON.stringify((error as { keyPattern?: unknown }).keyPattern ?? {}).includes(
          'referenceCode',
        )
      if (!onReference || attempt === attempts - 1) throw error
    }
  }
  throw new HttpError(500, 'Could not allocate a unique booking reference')
}

/** Advances the laundry lifecycle, firing the ready-for-collection SMS. */
export async function updateBookingStatus(params: {
  bookingId: string
  status: BookingStatus
  byUserId: string
}): Promise<BookingDoc> {
  const booking = await BookingModel.findById(params.bookingId)
  if (!booking) throw new HttpError(404, 'Booking not found')

  if (booking.status === params.status) return booking

  if (!canTransition(booking.status, params.status)) {
    throw new HttpError(400, `Cannot move a booking from ${booking.status} to ${params.status}`)
  }

  booking.status = params.status
  booking.statusHistory.push({
    status: params.status,
    at: new Date(),
    byUserId: new Types.ObjectId(params.byUserId),
  })
  if (params.status === 'collected') booking.collectedAt = new Date()
  await booking.save()

  if (params.status === 'ready_for_collection') {
    const [customer, branch] = await Promise.all([
      CustomerModel.findById(booking.customerId),
      BranchModel.findById(booking.branchId),
    ])
    if (customer && branch) {
      await sendSms({
        to: customer.phone,
        message: readyForCollectionMessage({
          customerName: customer.name,
          referenceCode: booking.referenceCode,
          balanceMinor: booking.totalMinor - booking.paidMinor,
          branchName: branch.name,
        }),
        dedupeKey: `booking:${booking._id.toString()}:ready`,
        bookingId: booking._id.toString(),
      })
    }
  }

  return booking
}

export async function recordPayment(params: {
  bookingId: string
  amountMinor: number
}): Promise<BookingDoc> {
  if (params.amountMinor <= 0) throw new HttpError(400, 'Payment must be positive')

  const booking = await BookingModel.findById(params.bookingId)
  if (!booking) throw new HttpError(404, 'Booking not found')

  const balance = booking.totalMinor - booking.paidMinor
  if (params.amountMinor > balance) {
    throw new HttpError(400, `Payment exceeds the outstanding balance of ${balance / 100}`)
  }

  booking.paidMinor += params.amountMinor
  await booking.save() // pre-validate recomputes paymentStatus
  return booking
}
