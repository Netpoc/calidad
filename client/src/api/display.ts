import type { IconName } from '@/components/ui/icons'
import type { BookingStatus, PaymentStatus } from './types'

/**
 * Presentation metadata for statuses.
 *
 * Colour is never the only signal (WCAG 1.4.1): every status carries an icon
 * and a word as well, so it still reads correctly in greyscale, for a
 * colour-blind user, or on a washed-out phone screen in daylight.
 */
export interface StatusMeta {
  label: string
  icon: IconName
  /** Tailwind classes: tinted background + dark text, ≥4.5:1 on white. */
  classes: string
  /** What the staff member does next, used as the action button's label. */
  action?: string
}

export const BOOKING_STATUS_META: Record<BookingStatus, StatusMeta> = {
  received: {
    label: 'Received',
    icon: 'inbox',
    classes: 'bg-slate-100 text-slate-700 border-slate-200',
    action: 'Start washing',
  },
  in_progress: {
    label: 'In progress',
    icon: 'refresh',
    classes: 'bg-blue-50 text-blue-700 border-blue-200',
    action: 'Mark ready',
  },
  ready_for_collection: {
    label: 'Ready',
    icon: 'clock',
    classes: 'bg-green-50 text-green-700 border-green-200',
    action: 'Hand over',
  },
  collected: {
    label: 'Collected',
    icon: 'check-circle',
    classes: 'bg-slate-100 text-slate-500 border-slate-200',
  },
  cancelled: {
    label: 'Cancelled',
    icon: 'x-circle',
    classes: 'bg-red-50 text-red-700 border-red-200',
  },
}

export const PAYMENT_STATUS_META: Record<PaymentStatus, StatusMeta> = {
  unpaid: {
    label: 'Unpaid',
    icon: 'x-circle',
    classes: 'bg-red-50 text-red-700 border-red-200',
  },
  partial: {
    label: 'Part-paid',
    icon: 'clock',
    classes: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  paid: {
    label: 'Paid',
    icon: 'check-circle',
    classes: 'bg-green-50 text-green-700 border-green-200',
  },
}

/**
 * Category colours help staff jump to the right part of a 33-item price list.
 * The name is always shown too — the colour only speeds up the search.
 */
export interface CategoryMeta {
  label: string
  dot: string
  chipActive: string
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  native: { label: 'Native', dot: 'bg-violet-500', chipActive: 'bg-violet-600 text-white' },
  tops: { label: 'Tops', dot: 'bg-blue-500', chipActive: 'bg-blue-600 text-white' },
  bottoms: { label: 'Bottoms', dot: 'bg-cyan-500', chipActive: 'bg-cyan-600 text-white' },
  formal: { label: 'Formal', dot: 'bg-indigo-500', chipActive: 'bg-indigo-600 text-white' },
  dresses: { label: 'Dresses', dot: 'bg-pink-500', chipActive: 'bg-pink-600 text-white' },
  bedding: { label: 'Bedding', dot: 'bg-orange-500', chipActive: 'bg-orange-600 text-white' },
  towels: { label: 'Towels', dot: 'bg-green-500', chipActive: 'bg-green-600 text-white' },
  home: { label: 'Home', dot: 'bg-yellow-500', chipActive: 'bg-yellow-600 text-white' },
  bulk: { label: 'Bulk', dot: 'bg-slate-500', chipActive: 'bg-slate-600 text-white' },
  general: { label: 'Other', dot: 'bg-slate-400', chipActive: 'bg-slate-600 text-white' },
}

export function categoryMeta(key: string): CategoryMeta {
  return CATEGORY_META[key] ?? CATEGORY_META.general!
}
