import { Types } from 'mongoose'
import { BookingModel } from '../bookings/booking.model.js'
import { BranchModel } from '../branches/branch.model.js'
import {
  BUSINESS_TIMEZONE,
  LEDGER_METHODS,
  businessPeriodStarts,
  type LedgerMethod,
} from '../../shared/domain.js'

export type Period = 'day' | 'month' | 'year'

/**
 * What happened in a window of time. The two halves are dated differently on
 * purpose:
 *   - `billed*` is laundry booked in the window (by `createdAt`, cancelled
 *     bookings excluded) — the work taken in.
 *   - `collectedMinor` is money that changed hands in the window (by the
 *     ledger entry's `at`), payments minus refunds. A balance paid at pickup
 *     next week counts next week, so this matches the cash drawer and POS
 *     report, and a closed day never changes afterwards.
 */
export interface PeriodRevenue {
  billedMinor: number
  bookingCount: number
  /** Net cash in: payments minus refunds. */
  collectedMinor: number
  refundedMinor: number
  /** Net cash in, per mode of payment. */
  byMethod: Record<LedgerMethod, number>
}

/**
 * What is owed right now, independent of any window. Cancelled bookings are
 * refunded and owe nothing; everything else that is not fully paid counts —
 * in practice open bookings, plus any handed over owing before the ledger
 * existed. Over all time, billed = net collected + outstanding.
 */
export interface Outstanding {
  outstandingMinor: number
  owingBookingCount: number
  /** Laundry ready but not yet picked up, and what is still owed on it. */
  awaitingCollectionCount: number
  awaitingCollectionBalanceMinor: number
}

export interface RevenuePoint extends PeriodRevenue {
  key: string
}

interface Scope {
  tenantId: string
  /** `null` means every branch (owner scope); otherwise already validated. */
  branchIds: string[] | null
}

interface Window extends Scope {
  from: Date
  to: Date
}

/**
 * The one choke point for every dashboard aggregation, so the tenant filter
 * lives here and cannot be forgotten by a new report.
 */
export function scopeMatch(scope: Scope): Record<string, unknown> {
  const match: Record<string, unknown> = { tenantId: new Types.ObjectId(scope.tenantId) }
  if (scope.branchIds !== null) {
    match.branchId = { $in: scope.branchIds.map((id) => new Types.ObjectId(id)) }
  }
  return match
}

/** How rows are grouped: one total, one per time bucket, or one per branch. */
type Grouping = { by: 'all' } | { by: 'bucket'; period: Period } | { by: 'branch' }

const FORMATS: Record<Period, string> = {
  day: '%Y-%m-%d',
  month: '%Y-%m',
  year: '%Y',
}

function keyExpr(grouping: Grouping, dateField: string): unknown {
  if (grouping.by === 'all') return null
  if (grouping.by === 'branch') return '$branchId'
  return {
    $dateToString: { format: FORMATS[grouping.period], date: dateField, timezone: BUSINESS_TIMEZONE },
  }
}

function emptyRevenue(): PeriodRevenue {
  return {
    billedMinor: 0,
    bookingCount: 0,
    collectedMinor: 0,
    refundedMinor: 0,
    byMethod: Object.fromEntries(LEDGER_METHODS.map((m) => [m, 0])) as Record<LedgerMethod, number>,
  }
}

function keyOf(id: unknown): string {
  return id === null || id === undefined ? 'all' : String(id)
}

async function periodRevenue(window: Window, grouping: Grouping): Promise<Map<string, PeriodRevenue>> {
  const range = { $gte: window.from, $lt: window.to }
  const scope = scopeMatch(window)

  const [billedRows, cashRows] = await Promise.all([
    BookingModel.aggregate([
      { $match: { ...scope, status: { $ne: 'cancelled' }, createdAt: range } },
      {
        $group: {
          _id: keyExpr(grouping, '$createdAt'),
          billedMinor: { $sum: '$totalMinor' },
          bookingCount: { $sum: 1 },
        },
      },
    ]),
    // Cancelled bookings are included: a deposit and its refund are both real
    // movements of cash, and they net out on their own.
    BookingModel.aggregate([
      { $match: { ...scope, 'payments.at': range } },
      { $unwind: '$payments' },
      { $match: { 'payments.at': range } },
      {
        $group: {
          _id: { key: keyExpr(grouping, '$payments.at'), method: '$payments.method' },
          netMinor: {
            $sum: {
              $cond: [
                { $eq: ['$payments.kind', 'refund'] },
                { $multiply: ['$payments.amountMinor', -1] },
                '$payments.amountMinor',
              ],
            },
          },
          refundedMinor: {
            $sum: { $cond: [{ $eq: ['$payments.kind', 'refund'] }, '$payments.amountMinor', 0] },
          },
        },
      },
    ]),
  ])

  const out = new Map<string, PeriodRevenue>()
  const entry = (key: string) => {
    if (!out.has(key)) out.set(key, emptyRevenue())
    return out.get(key)!
  }
  for (const row of billedRows) {
    const e = entry(keyOf(row._id))
    e.billedMinor = row.billedMinor
    e.bookingCount = row.bookingCount
  }
  for (const row of cashRows) {
    const e = entry(keyOf(row._id.key))
    const method = row._id.method as LedgerMethod
    e.byMethod[method] = (e.byMethod[method] ?? 0) + row.netMinor
    e.collectedMinor += row.netMinor
    e.refundedMinor += row.refundedMinor
  }
  return out
}

async function outstanding(scope: Scope, perBranch: boolean): Promise<Map<string, Outstanding>> {
  const balance = { $subtract: ['$totalMinor', '$paidMinor'] }
  const ready = { $eq: ['$status', 'ready_for_collection'] }
  const rows = await BookingModel.aggregate([
    {
      $match: {
        ...scopeMatch(scope),
        status: { $ne: 'cancelled' },
        $expr: { $lt: ['$paidMinor', '$totalMinor'] },
      },
    },
    {
      $group: {
        _id: perBranch ? '$branchId' : null,
        outstandingMinor: { $sum: balance },
        owingBookingCount: { $sum: 1 },
        awaitingCollectionCount: { $sum: { $cond: [ready, 1, 0] } },
        awaitingCollectionBalanceMinor: { $sum: { $cond: [ready, balance, 0] } },
      },
    },
  ])
  return new Map(
    rows.map((row) => [
      keyOf(row._id),
      {
        outstandingMinor: row.outstandingMinor,
        owingBookingCount: row.owingBookingCount,
        awaitingCollectionCount: row.awaitingCollectionCount,
        awaitingCollectionBalanceMinor: row.awaitingCollectionBalanceMinor,
      },
    ]),
  )
}

const NOTHING_OUTSTANDING: Outstanding = {
  outstandingMinor: 0,
  owingBookingCount: 0,
  awaitingCollectionCount: 0,
  awaitingCollectionBalanceMinor: 0,
}

export async function summarize(window: Window): Promise<PeriodRevenue> {
  const rows = await periodRevenue(window, { by: 'all' })
  return rows.get('all') ?? emptyRevenue()
}

/** A time series for the dashboard charts, bucketed by Lagos day, month, or year. */
export async function timeSeries(window: Window & { period: Period }): Promise<RevenuePoint[]> {
  const rows = await periodRevenue(window, { by: 'bucket', period: window.period })
  return [...rows.entries()]
    .map(([key, revenue]) => ({ key, ...revenue }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** Per-branch breakdown, so an owner can compare branches at a glance. */
export async function byBranch(
  window: Window,
): Promise<Array<PeriodRevenue & Outstanding & { branchId: string; branchName: string }>> {
  const [revenue, owed] = await Promise.all([
    periodRevenue(window, { by: 'branch' }),
    outstanding(window, true),
  ])
  const ids = [...new Set([...revenue.keys(), ...owed.keys()])]
  // A branch that has since been removed still owns its money; never drop it.
  const branches = await BranchModel.find({ _id: { $in: ids }, tenantId: window.tenantId })
    .select('name')
    .lean()
  const names = new Map(branches.map((b) => [b._id.toString(), b.name]))

  return ids
    .map((id) => ({
      branchId: id,
      branchName: names.get(id) ?? 'Removed branch',
      ...(revenue.get(id) ?? emptyRevenue()),
      ...(owed.get(id) ?? NOTHING_OUTSTANDING),
    }))
    .sort((a, b) => b.billedMinor - a.billedMinor)
}

/** Day / month / year to date in Lagos time, plus what is owed right now. */
export async function headline(
  params: Scope & { now?: Date },
): Promise<Record<Period, PeriodRevenue> & { outstanding: Outstanding }> {
  const now = params.now ?? new Date()
  const starts = businessPeriodStarts(now)
  const end = new Date(now.getTime() + 1000)

  const scope = { tenantId: params.tenantId, branchIds: params.branchIds }
  const [day, month, year, owed] = await Promise.all([
    summarize({ ...scope, from: starts.day, to: end }),
    summarize({ ...scope, from: starts.month, to: end }),
    summarize({ ...scope, from: starts.year, to: end }),
    outstanding(scope, false),
  ])

  return { day, month, year, outstanding: owed.get('all') ?? NOTHING_OUTSTANDING }
}
