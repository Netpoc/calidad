/** Mirrors server/src/shared/domain.ts — keep the two in step. */

export type Role = 'platform_admin' | 'owner' | 'manager' | 'staff' | 'customer'

/** Single source of truth — the router and auth store both import this. */
export const ROLE_RANK: Record<Role, number> = {
  platform_admin: 4,
  owner: 3,
  manager: 2,
  staff: 1,
  customer: 0,
}
export type ServiceTier = 'wash_starch_iron' | 'starch_iron'
export type BookingStatus =
  | 'received'
  | 'in_progress'
  | 'ready_for_collection'
  | 'collected'
  | 'cancelled'
export type PaymentStatus = 'unpaid' | 'partial' | 'paid'

/** Modes staff may choose. `unrecorded` only appears on migrated history. */
export const PAYMENT_METHODS = ['cash', 'transfer', 'pos'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export type LedgerMethod = PaymentMethod | 'unrecorded'
export type LedgerKind = 'payment' | 'refund'
/** Set by the server: `deposit` leaves a balance, `balance` clears it. */
export type PaymentStage = 'deposit' | 'balance' | 'refund'

export const SERVICE_TIER_LABELS: Record<ServiceTier, string> = {
  wash_starch_iron: 'Wash, Starch & Iron',
  starch_iron: 'Starch & Iron',
}

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  received: 'Received',
  in_progress: 'In progress',
  ready_for_collection: 'Ready for collection',
  collected: 'Collected',
  cancelled: 'Cancelled',
}

export interface AuthUser {
  id: string
  name: string
  email: string
  role: Role
  branchIds: string[]
  /** Null only for the platform admin, who belongs to no business. */
  tenantId: string | null
  tenantName: string | null
}

export interface TenantSummary {
  id: string
  name: string
  active: boolean
  createdAt: string
  counts: { users: number; branches: number; bookings: number }
}

export interface Branch {
  _id: string
  name: string
  isHeadquarters: boolean
  address?: string
  active: boolean
}

export interface PriceItem {
  _id: string
  name: string
  category: string
  /** `null` means the tier is not offered — never treat it as free. */
  washStarchIronMinor: number | null
  starchIronMinor: number | null
  sortOrder: number
}

export interface Customer {
  _id: string
  customerId: string
  name: string
  phone: string
  email?: string
  address?: string
}

export interface BookingItem {
  priceItemId: string
  name: string
  tier: ServiceTier
  quantity: number
  unitPriceMinor: number
  lineTotalMinor: number
}

/** A user id, or the `{ _id, name }` the detail endpoint populates it to. */
export type UserRef = string | { _id: string; name: string; role?: Role }

/** One movement of money. Append-only on the server. */
export interface LedgerEntry {
  _id: string
  kind: LedgerKind
  amountMinor: number
  method: LedgerMethod
  stage: PaymentStage
  at: string
  byUserId: UserRef
  note?: string
}

export interface StatusEvent {
  status: BookingStatus
  at: string
  byUserId?: UserRef
}

export interface Booking {
  _id: string
  referenceCode: string
  branchId: string | Branch
  customerId: string | Customer
  createdByUserId?: UserRef
  items: BookingItem[]
  subtotalMinor: number
  discountMinor: number
  totalMinor: number
  paidMinor: number
  paymentStatus: PaymentStatus
  status: BookingStatus
  statusHistory: StatusEvent[]
  payments: LedgerEntry[]
  collectedAt?: string
  collectedByUserId?: UserRef
  cancelledByUserId?: UserRef
  createdAt: string
}

/**
 * Billed is dated by booking; collected by when the money changed hands, so
 * "collected today" matches the cash drawer.
 */
export interface PeriodRevenue {
  billedMinor: number
  bookingCount: number
  /** Net cash in: payments minus refunds. */
  collectedMinor: number
  refundedMinor: number
  byMethod: Record<LedgerMethod, number>
}

/** Owed right now — not tied to a period. */
export interface Outstanding {
  outstandingMinor: number
  owingBookingCount: number
  awaitingCollectionCount: number
  awaitingCollectionBalanceMinor: number
}

export interface RevenueHeadline {
  day: PeriodRevenue
  month: PeriodRevenue
  year: PeriodRevenue
  outstanding: Outstanding
}

export type BranchRevenue = PeriodRevenue & Outstanding & { branchId: string; branchName: string }

export interface TillEntry {
  entryId: string
  bookingId: string
  referenceCode: string
  customerName: string
  branchName: string
  kind: LedgerKind
  amountMinor: number
  method: LedgerMethod
  stage: PaymentStage
  at: string
  byUserId: string
  byUserName: string
  note?: string
}

export interface TillHandover {
  bookingId: string
  referenceCode: string
  customerName: string
  branchName: string
  totalMinor: number
  collectedAt: string
  byUserId: string
  byUserName: string
}

export interface TillReport {
  entries: TillEntry[]
  handovers: TillHandover[]
  totals: {
    inMinor: number
    refundedMinor: number
    netMinor: number
    byMethod: Record<LedgerMethod, number>
    byUser: Array<{ userId: string; name: string; netMinor: number; byMethod: Record<LedgerMethod, number> }>
  }
}
