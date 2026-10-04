import { Types } from 'mongoose'
import { BookingModel } from '../bookings/booking.model.js'
import { scopeMatch } from '../dashboard/dashboard.service.js'
import {
  LEDGER_METHODS,
  type LedgerKind,
  type LedgerMethod,
  type PaymentStage,
} from '../../shared/domain.js'

export interface LedgerRow {
  entryId: string
  bookingId: string
  referenceCode: string
  customerName: string
  branchName: string
  kind: LedgerKind
  amountMinor: number
  method: LedgerMethod
  stage: PaymentStage
  at: Date
  byUserId: string
  byUserName: string
  note?: string
}

export interface HandoverRow {
  bookingId: string
  referenceCode: string
  customerName: string
  branchName: string
  totalMinor: number
  collectedAt: Date
  byUserId: string
  byUserName: string
}

type ByMethod = Record<LedgerMethod, number>

export interface TillReport {
  entries: LedgerRow[]
  handovers: HandoverRow[]
  totals: {
    inMinor: number
    refundedMinor: number
    netMinor: number
    byMethod: ByMethod
    /** What each staff member should be able to account for. */
    byUser: Array<{ userId: string; name: string; netMinor: number; byMethod: ByMethod }>
  }
}

const lookupName = (from: string, localField: string, as: string) => [
  { $lookup: { from, localField, foreignField: '_id', as, pipeline: [{ $project: { name: 1 } }] } },
  { $set: { [as]: { $ifNull: [{ $first: `$${as}.name` }, 'Unknown'] } } },
]

function zeroByMethod(): ByMethod {
  return Object.fromEntries(LEDGER_METHODS.map((m) => [m, 0])) as ByMethod
}

/**
 * The till report: every movement of money in the window — who took it, how,
 * and on which booking — and every handover. Managers reconcile the cash
 * drawer and POS slips against `totals.byUser`.
 */
export async function tillReport(params: {
  tenantId: string
  branchIds: string[] | null
  from: Date
  to: Date
  method?: LedgerMethod
  userId?: string
}): Promise<TillReport> {
  const range = { $gte: params.from, $lt: params.to }
  const scope = scopeMatch(params)

  const entryFilter: Record<string, unknown> = { 'payments.at': range }
  if (params.method) entryFilter['payments.method'] = params.method
  if (params.userId) entryFilter['payments.byUserId'] = new Types.ObjectId(params.userId)

  const handoverFilter: Record<string, unknown> = { ...scope, collectedAt: range }
  if (params.userId) handoverFilter.collectedByUserId = new Types.ObjectId(params.userId)

  const [entryRows, handoverRows] = await Promise.all([
    BookingModel.aggregate([
      { $match: { ...scope, 'payments.at': range } },
      { $unwind: '$payments' },
      { $match: entryFilter },
      ...lookupName('users', 'payments.byUserId', 'byUserName'),
      ...lookupName('customers', 'customerId', 'customerName'),
      ...lookupName('branches', 'branchId', 'branchName'),
      { $sort: { 'payments.at': -1 } },
    ]),
    params.method
      ? Promise.resolve([])
      : BookingModel.aggregate([
          { $match: handoverFilter },
          ...lookupName('users', 'collectedByUserId', 'byUserName'),
          ...lookupName('customers', 'customerId', 'customerName'),
          ...lookupName('branches', 'branchId', 'branchName'),
          { $sort: { collectedAt: -1 } },
        ]),
  ])

  const entries: LedgerRow[] = entryRows.map((row) => ({
    entryId: String(row.payments._id ?? ''),
    bookingId: row._id.toString(),
    referenceCode: row.referenceCode,
    customerName: row.customerName,
    branchName: row.branchName,
    kind: row.payments.kind,
    amountMinor: row.payments.amountMinor,
    method: row.payments.method,
    stage: row.payments.stage,
    at: row.payments.at,
    byUserId: row.payments.byUserId.toString(),
    byUserName: row.byUserName,
    note: row.payments.note,
  }))

  const handovers: HandoverRow[] = handoverRows.map((row) => ({
    bookingId: row._id.toString(),
    referenceCode: row.referenceCode,
    customerName: row.customerName,
    branchName: row.branchName,
    totalMinor: row.totalMinor,
    collectedAt: row.collectedAt,
    byUserId: row.collectedByUserId?.toString() ?? '',
    byUserName: row.byUserName,
  }))

  const totals: TillReport['totals'] = {
    inMinor: 0,
    refundedMinor: 0,
    netMinor: 0,
    byMethod: zeroByMethod(),
    byUser: [],
  }
  const users = new Map<string, TillReport['totals']['byUser'][number]>()
  for (const e of entries) {
    const signed = e.kind === 'refund' ? -e.amountMinor : e.amountMinor
    if (e.kind === 'refund') totals.refundedMinor += e.amountMinor
    else totals.inMinor += e.amountMinor
    totals.netMinor += signed
    totals.byMethod[e.method] += signed

    if (!users.has(e.byUserId)) {
      users.set(e.byUserId, { userId: e.byUserId, name: e.byUserName, netMinor: 0, byMethod: zeroByMethod() })
    }
    const user = users.get(e.byUserId)!
    user.netMinor += signed
    user.byMethod[e.method] += signed
  }
  totals.byUser = [...users.values()].sort((a, b) => b.netMinor - a.netMinor)

  return { entries, handovers, totals }
}
