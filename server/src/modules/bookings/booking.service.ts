import { Types, type UpdateQuery } from 'mongoose'
import { BranchModel } from '../branches/branch.model.js'
import { CustomerModel } from '../customers/customer.model.js'
import { findOrCreateByPhone } from '../customers/customer.service.js'
import { PriceItemModel } from '../pricing/price-item.model.js'
import { TenantModel } from '../tenants/tenant.model.js'
import {
  bookingConfirmedMessage,
  formatNaira,
  readyForCollectionMessage,
  sendSms,
} from '../notifications/sms.service.js'
import {
  ROLE_RANK,
  canTransition,
  paymentStageFor,
  paymentStatusFor,
  type BookingStatus,
  type LedgerKind,
  type LedgerMethod,
  type PaymentMethod,
  type PaymentStage,
  type Role,
  type ServiceTier,
} from '../../shared/domain.js'
import { HttpError } from '../../shared/http-error.js'
import { BookingModel, type Booking, type BookingDoc } from './booking.model.js'

export interface BookingItemInput {
  priceItemId: string
  tier: ServiceTier
  quantity: number
}

export interface CreateBookingInput {
  tenantId: string
  branchId: string
  createdByUserId: string
  customer: { name: string; phone: string; email?: string; address?: string }
  items: BookingItemInput[]
  discountMinor?: number
  paidMinor?: number
  /** Required whenever `paidMinor` is positive. */
  paymentMethod?: PaymentMethod
  /** When an offline device took the money; clamped to the last 7 days. */
  takenAt?: Date
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
  const { tenantId } = input

  if (input.clientRequestId) {
    const existing = await BookingModel.findOne({ tenantId, clientRequestId: input.clientRequestId })
    if (existing) {
      // A replayed offline booking. Return the original rather than creating a
      // duplicate — and note that no SMS is re-sent.
      return { booking: existing, customerCreated: false, replayed: true }
    }
  }

  // Scoped by tenant even though the route already checked: the service must
  // be safe on its own, whoever calls it.
  const [branch, tenant] = await Promise.all([
    BranchModel.findOne({ _id: input.branchId, tenantId, active: true }),
    TenantModel.findById(tenantId).select('name').lean(),
  ])
  if (!branch) throw new HttpError(404, 'Branch not found or inactive')
  if (!tenant) throw new HttpError(404, 'Business not found')

  if (input.items.length === 0) {
    throw new HttpError(400, 'A booking must contain at least one item')
  }

  const { customer, created } = await findOrCreateByPhone({
    ...input.customer,
    tenantId,
    homeBranchId: input.branchId,
  })

  const items = await priceItems(input.items, tenantId, input.branchId)

  // Validated against the server's price, not the client's provisional one.
  const subtotal = items.reduce((sum, item) => sum + item.lineTotalMinor, 0)
  const total = Math.max(0, subtotal - (input.discountMinor ?? 0))
  const paid = input.paidMinor ?? 0
  if (paid > total) {
    throw new HttpError(400, `Amount paid exceeds the booking total of ${formatNaira(total)}`)
  }
  // A booking queued offline before payment modes existed still syncs; its
  // money is booked honestly as `unrecorded` rather than guessed.
  const method: LedgerMethod | undefined =
    input.paymentMethod ?? (input.syncedFromOffline ? 'unrecorded' : undefined)
  if (paid > 0 && !method) {
    throw new HttpError(400, 'Say how the customer paid (cash, transfer or POS)')
  }
  const payments =
    paid > 0
      ? [
          ledgerEntry({
            kind: 'payment',
            amountMinor: paid,
            method: method!,
            stage: paymentStageFor(total, paid),
            byUserId: input.createdByUserId,
            at: clampTakenAt(input.takenAt),
          }),
        ]
      : []

  const booking = await createWithUniqueReference({
    tenantId: new Types.ObjectId(tenantId),
    branchId: new Types.ObjectId(input.branchId),
    customerId: customer._id,
    createdByUserId: new Types.ObjectId(input.createdByUserId),
    items,
    discountMinor: input.discountMinor ?? 0,
    paidMinor: paid,
    payments,
    expectedReadyAt: input.expectedReadyAt,
    status: 'received',
    statusHistory: [
      { status: 'received', at: new Date(), byUserId: new Types.ObjectId(input.createdByUserId) },
    ],
    clientRequestId: input.clientRequestId ?? null,
    syncedFromOffline: input.syncedFromOffline ?? false,
  })

  await sendSms({
    tenantId,
    to: customer.phone,
    message: bookingConfirmedMessage({
      customerName: customer.name,
      referenceCode: booking.referenceCode,
      totalMinor: booking.totalMinor,
      businessName: tenant.name,
      branchName: branch.name,
    }),
    dedupeKey: `booking:${booking._id.toString()}:confirmed`,
    bookingId: booking._id.toString(),
  })

  return { booking, customerCreated: created, replayed: false }
}

/** An offline device's clock is trusted only within the last week, never the future. */
function clampTakenAt(takenAt: Date | undefined): Date {
  const now = new Date()
  if (!takenAt || Number.isNaN(takenAt.getTime())) return now
  const floor = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  if (takenAt > now) return now
  if (takenAt < floor) return floor
  return takenAt
}

/**
 * Resolves each line against the price list, rejecting tiers an item does not
 * offer — a missing tier price means "not offered", not free (CLAUDE.md).
 */
async function priceItems(inputs: BookingItemInput[], tenantId: string, branchId: string) {
  const ids = inputs.map((item) => item.priceItemId)
  const priceItems = await PriceItemModel.find({
    _id: { $in: ids },
    tenantId,
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

/**
 * Every change to a booking's money or status goes through here. It reads the
 * booking, lets `plan` validate against that state and describe the update,
 * then writes only if `paidMinor` and `status` are still what was read. Two
 * staff taking the same balance at once therefore cannot both succeed — the
 * loser re-reads and gets an honest "exceeds the balance" error. `plan`
 * returns `null` when there is nothing to write (a replayed request).
 */
async function mutateBooking(
  tenantId: string,
  bookingId: string,
  plan: (booking: BookingDoc) => UpdateQuery<Booking> | null,
): Promise<{ booking: BookingDoc; changed: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const booking = await BookingModel.findOne({ _id: bookingId, tenantId })
    if (!booking) throw new HttpError(404, 'Booking not found')

    const update = plan(booking)
    if (!update) return { booking, changed: false }

    const updated = await BookingModel.findOneAndUpdate(
      { _id: booking._id, tenantId, paidMinor: booking.paidMinor, status: booking.status },
      update,
      { new: true },
    )
    if (updated) return { booking: updated, changed: true }
  }
  throw new HttpError(409, 'This booking was changed by someone else — refresh and try again')
}

function ledgerEntry(fields: {
  kind: LedgerKind
  amountMinor: number
  method: LedgerMethod
  stage: PaymentStage
  byUserId: string
  note?: string
  clientRequestId?: string
  at?: Date
}) {
  return {
    ...fields,
    _id: new Types.ObjectId(),
    at: fields.at ?? new Date(),
    byUserId: new Types.ObjectId(fields.byUserId),
  }
}

/**
 * Money moves only on live bookings. The one exception is a booking handed over
 * while still owing — impossible now, but allowed before the ledger — so its
 * late balance can still be taken and the books closed.
 */
function assertOpenForMoney(booking: BookingDoc) {
  if (booking.status === 'collected' && booking.paidMinor >= booking.totalMinor) {
    throw new HttpError(400, 'This laundry has already been collected and fully paid')
  }
  if (booking.status === 'cancelled') {
    throw new HttpError(400, 'This booking was cancelled')
  }
}

/**
 * Advances the laundry lifecycle, firing the ready-for-collection SMS.
 * Handing laundry over is not a status change — it goes through
 * `collectBooking`, which insists on a zero balance. Cancelling a booking that
 * holds money needs a manager and a refund entry, so the books still balance.
 */
export async function updateBookingStatus(params: {
  tenantId: string
  bookingId: string
  status: BookingStatus
  byUserId: string
  actorRole: Role
  refund?: { method: PaymentMethod; note?: string }
}): Promise<BookingDoc> {
  if (params.status === 'collected') {
    throw new HttpError(400, 'Use the collect action to hand laundry over — it checks the balance')
  }

  const { booking, changed } = await mutateBooking(params.tenantId, params.bookingId, (current) => {
    if (current.status === params.status) return null
    if (!canTransition(current.status, params.status)) {
      throw new HttpError(400, `Cannot move a booking from ${current.status} to ${params.status}`)
    }

    const now = new Date()
    const event = { status: params.status, at: now, byUserId: new Types.ObjectId(params.byUserId) }

    if (params.status !== 'cancelled') {
      return { $set: { status: params.status }, $push: { statusHistory: event } }
    }

    const update: UpdateQuery<Booking> = {
      $set: { status: 'cancelled', cancelledByUserId: new Types.ObjectId(params.byUserId) },
      $push: { statusHistory: event },
    }
    if (current.paidMinor > 0) {
      if (ROLE_RANK[params.actorRole] < ROLE_RANK.manager) {
        throw new HttpError(403, 'Only a manager or owner can cancel a booking that has been paid for')
      }
      if (!params.refund) {
        throw new HttpError(
          400,
          `This booking holds ${formatNaira(current.paidMinor)} — record how it was refunded`,
        )
      }
      update.$set!.paidMinor = 0
      update.$set!.paymentStatus = paymentStatusFor(current.totalMinor, 0)
      update.$push!.payments = ledgerEntry({
        kind: 'refund',
        amountMinor: current.paidMinor,
        method: params.refund.method,
        stage: 'refund',
        byUserId: params.byUserId,
        note: params.refund.note,
        at: now,
      })
    }
    return update
  })

  if (changed && params.status === 'ready_for_collection') {
    const [customer, branch, tenant] = await Promise.all([
      CustomerModel.findOne({ _id: booking.customerId, tenantId: params.tenantId }),
      BranchModel.findOne({ _id: booking.branchId, tenantId: params.tenantId }),
      TenantModel.findById(params.tenantId).select('name').lean(),
    ])
    if (customer && branch && tenant) {
      await sendSms({
        tenantId: params.tenantId,
        to: customer.phone,
        message: readyForCollectionMessage({
          customerName: customer.name,
          referenceCode: booking.referenceCode,
          balanceMinor: booking.totalMinor - booking.paidMinor,
          businessName: tenant.name,
          branchName: branch.name,
        }),
        dedupeKey: `booking:${booking._id.toString()}:ready`,
        bookingId: booking._id.toString(),
      })
    }
  }

  return booking
}

/** Takes a deposit, part-payment or the balance, and records who took it and how. */
export async function recordPayment(params: {
  tenantId: string
  bookingId: string
  amountMinor: number
  method: PaymentMethod
  byUserId: string
  note?: string
  clientRequestId?: string
}): Promise<BookingDoc> {
  if (params.amountMinor <= 0) throw new HttpError(400, 'Payment must be positive')

  const { booking } = await mutateBooking(params.tenantId, params.bookingId, (current) => {
    if (
      params.clientRequestId &&
      current.payments.some((p) => p.clientRequestId === params.clientRequestId)
    ) {
      return null // a retried request: the payment is already on the books
    }
    assertOpenForMoney(current)

    const balance = current.totalMinor - current.paidMinor
    if (params.amountMinor > balance) {
      throw new HttpError(400, `Payment exceeds the outstanding balance of ${formatNaira(balance)}`)
    }

    const paidAfter = current.paidMinor + params.amountMinor
    return {
      $inc: { paidMinor: params.amountMinor },
      $set: { paymentStatus: paymentStatusFor(current.totalMinor, paidAfter) },
      $push: {
        payments: ledgerEntry({
          kind: 'payment',
          amountMinor: params.amountMinor,
          method: params.method,
          stage: paymentStageFor(current.totalMinor, paidAfter),
          byUserId: params.byUserId,
          note: params.note,
          clientRequestId: params.clientRequestId,
        }),
      },
    }
  })
  return booking
}

/**
 * Hands the laundry over. A booking can only be collected fully paid, so any
 * outstanding balance must be taken in the same step — the amount is always
 * the server's own balance, never one the client supplies.
 */
export async function collectBooking(params: {
  tenantId: string
  bookingId: string
  byUserId: string
  payment?: { method: PaymentMethod; note?: string }
}): Promise<BookingDoc> {
  const { booking } = await mutateBooking(params.tenantId, params.bookingId, (current) => {
    if (current.status === 'collected') return null
    if (current.status !== 'ready_for_collection') {
      throw new HttpError(400, 'Only laundry that is ready for collection can be handed over')
    }

    const now = new Date()
    const byUserId = new Types.ObjectId(params.byUserId)
    const balance = current.totalMinor - current.paidMinor
    const update: UpdateQuery<Booking> = {
      $set: {
        status: 'collected',
        collectedAt: now,
        collectedByUserId: byUserId,
        paymentStatus: 'paid',
      },
      $push: { statusHistory: { status: 'collected', at: now, byUserId } },
    }

    if (balance > 0) {
      if (!params.payment) {
        throw new HttpError(
          409,
          `Balance of ${formatNaira(balance)} outstanding — take payment before handing over`,
        )
      }
      update.$inc = { paidMinor: balance }
      update.$push!.payments = ledgerEntry({
        kind: 'payment',
        amountMinor: balance,
        method: params.payment.method,
        stage: 'balance',
        byUserId: params.byUserId,
        note: params.payment.note,
        at: now,
      })
    }
    return update
  })
  return booking
}
