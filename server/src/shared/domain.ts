/**
 * Domain vocabulary shared across modules. Keep this file free of Mongoose so
 * it can be imported by scripts, tests, and (by copy) the client.
 */

/**
 * `platform_admin` is the SaaS operator: creates businesses (tenants) and
 * nothing else. It has no tenant of its own and is blocked from every
 * business route by `requireTenant` — rank alone is not the gate.
 */
export const ROLES = ['platform_admin', 'owner', 'manager', 'staff', 'customer'] as const
export type Role = (typeof ROLES)[number]

/** Roles that live inside a business. Only these may be created via /auth/users. */
export const TENANT_ROLES = ['owner', 'manager', 'staff', 'customer'] as const
export type TenantRole = (typeof TENANT_ROLES)[number]

/** Higher rank implies every capability of the ranks below it. */
export const ROLE_RANK: Record<Role, number> = {
  platform_admin: 4,
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
 * `collected` means the customer has physically taken the laundry away. It can
 * only be reached through the collect flow, which refuses while any balance is
 * outstanding — so a collected booking is always fully paid.
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
 * Money is tracked in kobo (minor units) to keep arithmetic exact. Payment
 * status is derived from the ledger total; it says nothing about whether the
 * laundry has been handed over (that is `status: 'collected'`).
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

/**
 * How money changed hands. `unrecorded` exists only for payments migrated from
 * before the ledger; the API never accepts it as input.
 */
export const PAYMENT_METHODS = ['cash', 'transfer', 'pos'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export const LEDGER_METHODS = [...PAYMENT_METHODS, 'unrecorded'] as const
export type LedgerMethod = (typeof LEDGER_METHODS)[number]

/** A ledger entry either brings money in or gives it back. */
export const LEDGER_KINDS = ['payment', 'refund'] as const
export type LedgerKind = (typeof LEDGER_KINDS)[number]

/**
 * Set by the server, never the client: a payment that leaves a balance is a
 * `deposit` (part-payment); one that clears it is the `balance`.
 */
export const PAYMENT_STAGES = ['deposit', 'balance', 'refund'] as const
export type PaymentStage = (typeof PAYMENT_STAGES)[number]

export function paymentStageFor(totalMinor: number, paidAfterMinor: number): PaymentStage {
  return paidAfterMinor >= totalMinor ? 'balance' : 'deposit'
}

/**
 * Business day boundaries. Every tenant is in Nigeria today; Lagos is a fixed
 * UTC+1 with no daylight saving, so the arithmetic is exact. Deriving these
 * from the server clock instead would put "today" at 01:00–01:00 on Render.
 */
export const BUSINESS_TIMEZONE = 'Africa/Lagos'
const LAGOS_OFFSET_MS = 60 * 60 * 1000

export function businessPeriodStarts(now: Date): { day: Date; month: Date; year: Date } {
  const local = new Date(now.getTime() + LAGOS_OFFSET_MS)
  const y = local.getUTCFullYear()
  const m = local.getUTCMonth()
  const d = local.getUTCDate()
  const toUtc = (ms: number) => new Date(ms - LAGOS_OFFSET_MS)
  return {
    day: toUtc(Date.UTC(y, m, d)),
    month: toUtc(Date.UTC(y, m, 1)),
    year: toUtc(Date.UTC(y, 0, 1)),
  }
}
