import { Types } from 'mongoose'
import { BookingModel } from '../bookings/booking.model.js'
import { CustomerModel, type CustomerDoc } from './customer.model.js'
import { normalizePhone } from '../../shared/identity.js'

export interface CustomerInput {
  tenantId: string
  name: string
  phone: string
  email?: string
  address?: string
  homeBranchId?: string
}

/**
 * The dedup rule from CLAUDE.md: a returning customer keeps their original
 * customerId, and only the booking reference is new. Every booking path must
 * come through here rather than creating customers directly.
 *
 * Dedup is per business: the same phone at two laundries is two customers.
 *
 * Concurrency: two tills registering the same walk-in customer at once would
 * both miss on the read, so we lean on the unique phone index and treat a
 * duplicate-key error as "someone else won the race" and re-read.
 */
export async function findOrCreateByPhone(
  input: CustomerInput,
): Promise<{ customer: CustomerDoc; created: boolean }> {
  const phone = normalizePhone(input.phone)
  const { tenantId } = input

  const existing = await CustomerModel.findOne({ tenantId, phone })
  if (existing) {
    // Fill in details we did not have before, but never silently rename.
    let touched = false
    if (!existing.email && input.email) {
      existing.email = input.email
      touched = true
    }
    if (!existing.address && input.address) {
      existing.address = input.address
      touched = true
    }
    if (touched) await existing.save()
    return { customer: existing, created: false }
  }

  try {
    const customer = await CustomerModel.create({
      tenantId,
      name: input.name,
      phone,
      email: input.email ?? '',
      address: input.address ?? '',
      homeBranchId: input.homeBranchId ?? null,
    })
    return { customer, created: true }
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const raced = await CustomerModel.findOne({ tenantId, phone })
      if (raced) return { customer: raced, created: false }
    }
    throw error
  }
}

/**
 * `exactPhone` tells the booking form the hit *is* the number typed. Anything
 * looser (part of a number, a name) must never auto-fill a ticket, or a
 * half-typed phone would book under someone else's name.
 */
export async function searchCustomers(
  tenantId: string,
  query: string,
  limit = 20,
): Promise<{ customers: CustomerDoc[]; exactPhone: boolean }> {
  const trimmed = query.trim()
  if (!trimmed) return { customers: [], exactPhone: false }

  // A phone-shaped query is the common case at the counter, and it must match
  // regardless of how the staff member typed it.
  if (/\d/.test(trimmed)) {
    try {
      const byPhone = await CustomerModel.findOne({ tenantId, phone: normalizePhone(trimmed) })
      if (byPhone) return { customers: [byPhone], exactPhone: true }
    } catch {
      // Not a usable phone number; fall through to the wider search.
    }
  }

  const or: Array<Record<string, unknown>> = [
    { name: { $regex: escapeRegex(trimmed), $options: 'i' } },
    { customerId: trimmed.toUpperCase() },
  ]

  // Part of a number — "4567", or "0803 123" in local form. Stored phones are
  // E.164, so a leading 0 becomes 234 before matching. Four digits minimum,
  // or every customer matches "0".
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length >= 4 && digits.length === trimmed.replace(/[\s+()-]/g, '').length) {
    const local = digits.startsWith('0') ? `234${digits.slice(1)}` : digits
    or.push({ phone: { $regex: escapeRegex(local) } })
  }

  // A ticket reference finds whoever brought it in.
  const ticket = await BookingModel.findOne(
    { tenantId, referenceCode: trimmed.toUpperCase() },
    { customerId: 1 },
  )
  if (ticket) or.push({ _id: ticket.customerId })

  const customers = await CustomerModel.find({ tenantId, $or: or }).sort({ name: 1 }).limit(limit)
  return { customers, exactPhone: false }
}

export interface CustomerStats {
  bookingCount: number
  lastBookingAt: Date | null
  /** Sum of non-cancelled booking totals. */
  billedMinor: number
  /** Still owed on open and collected bookings — cancelled ones are refunded. */
  outstandingMinor: number
}

const EMPTY_STATS: CustomerStats = {
  bookingCount: 0,
  lastBookingAt: null,
  billedMinor: 0,
  outstandingMinor: 0,
}

/**
 * Visit history per customer, counting only bookings in branches the caller
 * may read (`null` = every branch). A customer is shared across the business,
 * but their bookings are branch-scoped like every other booking read.
 */
export async function customerStats(
  tenantId: string,
  customerIds: Types.ObjectId[],
  branchIds: string[] | null,
): Promise<Map<string, CustomerStats>> {
  const stats = new Map<string, CustomerStats>()
  if (customerIds.length === 0) return stats

  const match: Record<string, unknown> = {
    tenantId: new Types.ObjectId(tenantId),
    customerId: { $in: customerIds },
  }
  if (branchIds !== null) match.branchId = { $in: branchIds.map((id) => new Types.ObjectId(id)) }

  const live = { $ne: ['$status', 'cancelled'] }
  const rows = await BookingModel.aggregate<CustomerStats & { _id: Types.ObjectId }>([
    { $match: match },
    {
      $group: {
        _id: '$customerId',
        bookingCount: { $sum: 1 },
        lastBookingAt: { $max: '$createdAt' },
        billedMinor: { $sum: { $cond: [live, '$totalMinor', 0] } },
        outstandingMinor: {
          $sum: {
            $cond: [live, { $max: [0, { $subtract: ['$totalMinor', '$paidMinor'] }] }, 0],
          },
        },
      },
    },
  ])
  for (const { _id, ...row } of rows) stats.set(_id.toString(), row)
  return stats
}

export function statsFor(stats: Map<string, CustomerStats>, customerId: Types.ObjectId): CustomerStats {
  return stats.get(customerId.toString()) ?? EMPTY_STATS
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000
  )
}
