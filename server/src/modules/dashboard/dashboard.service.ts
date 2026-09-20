import { Types } from 'mongoose'
import { BookingModel } from '../bookings/booking.model.js'

export type Period = 'day' | 'month' | 'year'

export interface RevenueSummary {
  /** Everything billed in the window, cancelled bookings excluded. */
  billedMinor: number
  /** Cash actually received. */
  collectedMinor: number
  /** Billed but not yet received. */
  pendingMinor: number
  bookingCount: number
  /** Laundry ready but not yet picked up — an operational, not financial, count. */
  awaitingCollectionCount: number
}

export interface RevenuePoint extends RevenueSummary {
  key: string
}

/**
 * Revenue is derived from booking lifecycle and payment state, not from summing
 * totals (CLAUDE.md):
 *   - cancelled bookings are excluded entirely
 *   - "collected" is money received (paidMinor), which may be partial
 *   - "pending" is the outstanding balance, not the full total
 *
 * `branchIds` of `null` means every branch (owner scope); a non-null array is
 * the caller's authorized scope and must already have been validated.
 */
function matchStage(params: {
  tenantId: string
  branchIds: string[] | null
  from: Date
  to: Date
}): Record<string, unknown> {
  // The one choke point for every dashboard aggregation, so the tenant
  // filter lives here and cannot be forgotten by a new report.
  const match: Record<string, unknown> = {
    tenantId: new Types.ObjectId(params.tenantId),
    status: { $ne: 'cancelled' },
    createdAt: { $gte: params.from, $lt: params.to },
  }
  if (params.branchIds !== null) {
    match.branchId = { $in: params.branchIds.map((id) => new Types.ObjectId(id)) }
  }
  return match
}

const REVENUE_FIELDS = {
  billedMinor: { $sum: '$totalMinor' },
  collectedMinor: { $sum: '$paidMinor' },
  pendingMinor: { $sum: { $subtract: ['$totalMinor', '$paidMinor'] } },
  bookingCount: { $sum: 1 },
  awaitingCollectionCount: {
    $sum: { $cond: [{ $eq: ['$status', 'ready_for_collection'] }, 1, 0] },
  },
} as const

export async function summarize(params: {
  tenantId: string
  branchIds: string[] | null
  from: Date
  to: Date
}): Promise<RevenueSummary> {
  const [result] = await BookingModel.aggregate([
    { $match: matchStage(params) },
    { $group: { _id: null, ...REVENUE_FIELDS } },
  ])

  return {
    billedMinor: result?.billedMinor ?? 0,
    collectedMinor: result?.collectedMinor ?? 0,
    pendingMinor: result?.pendingMinor ?? 0,
    bookingCount: result?.bookingCount ?? 0,
    awaitingCollectionCount: result?.awaitingCollectionCount ?? 0,
  }
}

const FORMATS: Record<Period, string> = {
  day: '%Y-%m-%d',
  month: '%Y-%m',
  year: '%Y',
}

/** A time series for the dashboard charts, bucketed by day, month, or year. */
export async function timeSeries(params: {
  tenantId: string
  branchIds: string[] | null
  from: Date
  to: Date
  period: Period
  timezone?: string
}): Promise<RevenuePoint[]> {
  const rows = await BookingModel.aggregate([
    { $match: matchStage(params) },
    {
      $group: {
        _id: {
          $dateToString: {
            format: FORMATS[params.period],
            date: '$createdAt',
            timezone: params.timezone ?? 'Africa/Lagos',
          },
        },
        ...REVENUE_FIELDS,
      },
    },
    { $sort: { _id: 1 } },
  ])

  return rows.map((row) => ({
    key: row._id as string,
    billedMinor: row.billedMinor,
    collectedMinor: row.collectedMinor,
    pendingMinor: row.pendingMinor,
    bookingCount: row.bookingCount,
    awaitingCollectionCount: row.awaitingCollectionCount,
  }))
}

/** Per-branch breakdown, so an owner can compare branches at a glance. */
export async function byBranch(params: {
  tenantId: string
  branchIds: string[] | null
  from: Date
  to: Date
}): Promise<Array<RevenueSummary & { branchId: string; branchName: string }>> {
  const rows = await BookingModel.aggregate([
    { $match: matchStage(params) },
    { $group: { _id: '$branchId', ...REVENUE_FIELDS } },
    { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'branch' } },
    { $unwind: '$branch' },
    { $sort: { billedMinor: -1 } },
  ])

  return rows.map((row) => ({
    branchId: row._id.toString(),
    branchName: row.branch.name as string,
    billedMinor: row.billedMinor,
    collectedMinor: row.collectedMinor,
    pendingMinor: row.pendingMinor,
    bookingCount: row.bookingCount,
    awaitingCollectionCount: row.awaitingCollectionCount,
  }))
}

/** Day / month / year to date, the three headline figures on the dashboard. */
export async function headline(params: {
  tenantId: string
  branchIds: string[] | null
  now?: Date
}): Promise<Record<Period, RevenueSummary>> {
  const now = params.now ?? new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const end = new Date(now.getTime() + 1000)

  const scope = { tenantId: params.tenantId, branchIds: params.branchIds }
  const [day, month, year] = await Promise.all([
    summarize({ ...scope, from: startOfDay, to: end }),
    summarize({ ...scope, from: startOfMonth, to: end }),
    summarize({ ...scope, from: startOfYear, to: end }),
  ])

  return { day, month, year }
}
