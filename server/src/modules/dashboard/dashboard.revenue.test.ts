import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BookingModel } from '../bookings/booking.model.js'
import { makeBooking, makeTenant, makeUser } from '../../test/fixtures.js'
import { startServer, type Api } from '../../test/http.js'
import { resetDb, startMongo, stopMongo } from '../../test/mongo.js'

let api: Api
let close: () => Promise<void>

beforeAll(async () => {
  await startMongo()
  ;({ api, close } = await startServer())
})
afterEach(resetDb)
afterAll(async () => {
  await close()
  await stopMongo()
})

interface Revenue {
  billedMinor: number
  bookingCount: number
  collectedMinor: number
  refundedMinor: number
  byMethod: Record<string, number>
}
interface Summary {
  day: Revenue
  month: Revenue
  year: Revenue
  outstanding: { outstandingMinor: number; awaitingCollectionCount: number; awaitingCollectionBalanceMinor: number }
}

const DAY = 86_400_000

describe('revenue is cash-basis and the books balance', () => {
  it('counts a deposit on the day it was taken and the balance on the day it was paid', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const booking = await makeBooking(api, t, '08031234567', { paidMinor: 20000, paymentMethod: 'cash' })

    // Pretend the booking and its deposit happened two days ago.
    const twoDaysAgo = new Date(Date.now() - 2 * DAY)
    // The raw collection, because Mongoose treats createdAt as immutable.
    await BookingModel.collection.updateOne(
      { _id: new Types.ObjectId(booking._id) },
      { $set: { createdAt: twoDaysAgo, 'payments.0.at': twoDaysAgo } },
    )

    await api.patch(`/bookings/${booking._id}/status`, { status: 'ready_for_collection' }, t.ownerToken)
    const before = await api.get<{ summary: Summary }>('/dashboard/summary', t.ownerToken)
    expect(before.body.summary.outstanding).toMatchObject({
      outstandingMinor: 30000,
      awaitingCollectionCount: 1,
      awaitingCollectionBalanceMinor: 30000,
    })

    await api.post(`/bookings/${booking._id}/collect`, { payment: { method: 'pos' } }, t.ownerToken)

    const { summary } = (await api.get<{ summary: Summary }>('/dashboard/summary', t.ownerToken)).body
    // Today: no new bookings, but the ₦300 balance came in by POS.
    expect(summary.day).toMatchObject({ billedMinor: 0, collectedMinor: 30000 })
    expect(summary.day.byMethod).toMatchObject({ pos: 30000, cash: 0 })
    expect(summary.outstanding.outstandingMinor).toBe(0)

    // The series puts each half of the money on its own day.
    const from = new Date(Date.now() - 5 * DAY).toISOString()
    const to = new Date(Date.now() + DAY).toISOString()
    const series = await api.get<{ series: Array<Revenue & { key: string }> }>(
      `/dashboard/series?from=${from}&to=${to}&period=day`,
      t.ownerToken,
    )
    expect(series.body.series.map((p) => p.collectedMinor)).toEqual([20000, 30000])
    expect(series.body.series[0]!.billedMinor).toBe(50000)
  })

  it('nets a refunded deposit to zero and drops the cancelled booking from billed', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const booking = await makeBooking(api, t, '08031234567', { paidMinor: 20000, paymentMethod: 'cash' })
    await api.patch(`/bookings/${booking._id}/status`, { status: 'cancelled', refund: { method: 'cash' } }, t.ownerToken)

    const { summary } = (await api.get<{ summary: Summary }>('/dashboard/summary', t.ownerToken)).body
    expect(summary.day).toMatchObject({ billedMinor: 0, collectedMinor: 0, refundedMinor: 20000 })
    expect(summary.day.byMethod.cash).toBe(0)
  })

  it('balances: everything billed = net cash in + what open bookings owe', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const a = await makeBooking(api, t, '08000000001', { paidMinor: 50000, paymentMethod: 'transfer' })
    const b = await makeBooking(api, t, '08000000002', { paidMinor: 10000, paymentMethod: 'cash' })
    await makeBooking(api, t, '08000000003')
    const c = await makeBooking(api, t, '08000000004', { paidMinor: 5000, paymentMethod: 'pos' })
    await api.post(`/bookings/${b._id}/payments`, { amountMinor: 15000, method: 'pos' }, t.ownerToken)
    await api.patch(`/bookings/${c._id}/status`, { status: 'cancelled', refund: { method: 'pos' } }, t.ownerToken)
    await api.patch(`/bookings/${a._id}/status`, { status: 'ready_for_collection' }, t.ownerToken)
    await api.post(`/bookings/${a._id}/collect`, {}, t.ownerToken)

    const { summary } = (await api.get<{ summary: Summary }>('/dashboard/summary', t.ownerToken)).body
    expect(summary.year.billedMinor).toBe(150000)
    expect(summary.year.collectedMinor).toBe(75000)
    expect(summary.outstanding.outstandingMinor).toBe(75000)
    expect(summary.year.billedMinor).toBe(summary.year.collectedMinor + summary.outstanding.outstandingMinor)
    expect(summary.year.byMethod).toMatchObject({ transfer: 50000, cash: 10000, pos: 15000 })
  })

  it('the till report says who took which money and who handed over', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const ada = await makeUser(api, t, 'staff', 'ada@a.test')
    const booking = await makeBooking(api, t, '08031234567', { paidMinor: 20000, paymentMethod: 'cash' }, ada.token)
    await api.patch(`/bookings/${booking._id}/status`, { status: 'ready_for_collection' }, t.ownerToken)
    await api.post(`/bookings/${booking._id}/collect`, { payment: { method: 'transfer' } }, t.ownerToken)

    const from = new Date(Date.now() - DAY).toISOString()
    const to = new Date(Date.now() + DAY).toISOString()
    const res = await api.get<{
      entries: Array<{ byUserName: string; amountMinor: number; stage: string; method: string; referenceCode: string }>
      handovers: Array<{ byUserName: string; referenceCode: string }>
      totals: { netMinor: number; byUser: Array<{ name: string; netMinor: number }> }
    }>(`/payments?from=${from}&to=${to}`, t.ownerToken)

    expect(res.status).toBe(200)
    expect(res.body.totals.netMinor).toBe(50000)
    expect(res.body.entries).toHaveLength(2)
    expect(res.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ byUserName: 'staff ada@a.test', amountMinor: 20000, stage: 'deposit', method: 'cash' }),
        expect.objectContaining({ byUserName: 'A owner', amountMinor: 30000, stage: 'balance', method: 'transfer' }),
      ]),
    )
    expect(res.body.handovers).toMatchObject([{ byUserName: 'A owner', referenceCode: booking.referenceCode }])
    expect(res.body.totals.byUser).toEqual(
      expect.arrayContaining([
        { userId: expect.any(String), name: 'staff ada@a.test', netMinor: 20000, byMethod: expect.any(Object) },
      ]),
    )

    // Staff cannot see the till report; another business sees nothing.
    expect((await api.get(`/payments?from=${from}&to=${to}`, ada.token)).status).toBe(403)
    const other = await makeTenant(api, 'B', 'b@b.test')
    const foreign = await api.get<{ entries: unknown[] }>(`/payments?from=${from}&to=${to}`, other.ownerToken)
    expect(foreign.body.entries).toHaveLength(0)
  })

  it('a manager cannot read another branch’s till', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const branch = await api.post<{ branch: { _id: string } }>('/branches', { name: 'Branch 1' }, t.ownerToken)
    const manager = await makeUser(api, t, 'manager', 'm@a.test', [branch.body.branch._id])
    const from = new Date(Date.now() - DAY).toISOString()
    const to = new Date(Date.now() + DAY).toISOString()
    const res = await api.get(`/payments?from=${from}&to=${to}&branchId=${t.hqId}`, manager.token)
    expect(res.status).toBe(403)
  })
})
