/** Mirrors server/src/shared/domain.ts — keep the two in step. */

export type Role = 'owner' | 'manager' | 'staff' | 'customer'
export type ServiceTier = 'wash_starch_iron' | 'starch_iron'
export type BookingStatus =
  | 'received'
  | 'in_progress'
  | 'ready_for_collection'
  | 'collected'
  | 'cancelled'
export type PaymentStatus = 'unpaid' | 'partial' | 'paid'

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

export interface Booking {
  _id: string
  referenceCode: string
  branchId: string | Branch
  customerId: string | Customer
  items: BookingItem[]
  subtotalMinor: number
  discountMinor: number
  totalMinor: number
  paidMinor: number
  paymentStatus: PaymentStatus
  status: BookingStatus
  createdAt: string
}

export interface RevenueSummary {
  billedMinor: number
  collectedMinor: number
  pendingMinor: number
  bookingCount: number
  awaitingCollectionCount: number
}
