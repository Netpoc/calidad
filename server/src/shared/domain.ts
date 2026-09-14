/**
 * Domain vocabulary shared across modules. Keep this file free of Mongoose so
 * it can be imported by scripts, tests, and (by copy) the client.
 */

export const ROLES = ['owner', 'manager', 'staff', 'customer'] as const
export type Role = (typeof ROLES)[number]

/** Higher rank implies every capability of the ranks below it. */
export const ROLE_RANK: Record<Role, number> = {
  owner: 3,
  manager: 2,
  staff: 1,
  customer: 0,
}

/**
 * The two service tiers in the price list. An item may legitimately offer only
 * the first (bedding, towels, curtains, "Bulk" have no starch-and-iron price),
 * so a missing tier means "not offered", never zero.
 */
export const SERVICE_TIERS = ['wash_starch_iron', 'starch_iron'] as const
export type ServiceTier = (typeof SERVICE_TIERS)[number]

export const SERVICE_TIER_LABELS: Record<ServiceTier, string> = {
  wash_starch_iron: 'Washing, Starching & Ironing',
  starch_iron: 'Starching & Ironing',
}

/**
 * Laundry lifecycle. `ready_for_collection` is an SMS trigger (see CLAUDE.md);
 * `collected` means the customer has physically taken the laundry away, which
 * is independent of whether they have paid.
 */
export const BOOKING_STATUSES = [
  'received',
  'in_progress',
  'ready_for_collection',
  'collected',
  'cancelled',
] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

/** Forward-only transitions, except that anything open may be cancelled. */
export const BOOKING_STATUS_FLOW: Record<BookingStatus, readonly BookingStatus[]> = {
  received: ['in_progress', 'ready_for_collection', 'cancelled'],
  in_progress: ['ready_for_collection', 'cancelled'],
  ready_for_collection: ['collected', 'cancelled'],
  collected: [],
  cancelled: [],
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_STATUS_FLOW[from].includes(to)
}

/**
 * Money is tracked in kobo (minor units) to keep arithmetic exact. Revenue
 * "collected" means cash received; "pending" means billed but not yet paid.
 */
export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export function paymentStatusFor(totalMinor: number, paidMinor: number): PaymentStatus {
  // Settled first: a booking discounted to zero owes nothing, and reporting it
  // as "unpaid" would leave staff chasing a balance that does not exist.
  if (paidMinor >= totalMinor) return 'paid'
  if (paidMinor <= 0) return 'unpaid'
  return 'partial'
}
