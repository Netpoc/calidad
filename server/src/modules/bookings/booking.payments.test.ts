import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BookingModel } from './booking.model.js'
import { makeBooking, makeTenant, makeUser, type TenantFixture } from '../../test/fixtures.js'
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

interface LedgerEntry {
  kind: string
  amountMinor: number
  method: string
  stage: string
  byUserId: string | { _id: string; name: string }
}
interface BookingBody {
  _id: string
  status: string
  totalMinor: number
  paidMinor: number
  paymentStatus: string
  payments: LedgerEntry[]
  collectedByUserId?: string | { _id: string; name: string }
}
type Res = { booking: BookingBody; error?: string }

/** One ₦500 shirt, advanced to ready for collection. */
async function readyBooking(t: TenantFixture, extra: Record<string, unknown> = {}, token?: string) {
  const booking = await makeBooking(api, t, '08031234567', extra, token)
  const ready = await api.patch(`/bookings/${booking._id}/status`, { status: 'ready_for_collection' }, t.ownerToken)
  expect(ready.status).toBe(200)
  return booking._id
}

describe('payments and collection', () => {
  it('records who took the deposit and who took the balance and handed over', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const ada = await makeUser(api, t, 'staff', 'ada@a.test')
    const tunde = await makeUser(api, t, 'staff', 'tunde@a.test')

    const id = await readyBooking(t, { paidMinor: 20000, paymentMethod: 'cash' }, ada.token)

    const collected = await api.post<Res>(`/bookings/${id}/collect`, { payment: { method: 'pos' } }, tunde.token)
    expect(collected.status).toBe(200)
    expect(collected.body.booking).toMatchObject({
      status: 'collected',
      paidMinor: 50000,
      paymentStatus: 'paid',
      collectedByUserId: tunde.userId,
    })
    expect(collected.body.booking.payments).toMatchObject([
      { kind: 'payment', amountMinor: 20000, method: 'cash', stage: 'deposit', byUserId: ada.userId },
      { kind: 'payment', amountMinor: 30000, method: 'pos', stage: 'balance', byUserId: tunde.userId },
    ])

    // The detail endpoint names the people for the audit timeline.
    const detail = await api.get<Res>(`/bookings/${id}`, t.ownerToken)
    expect(detail.body.booking.payments.map((p) => (p.byUserId as { name: string }).name)).toEqual([
      'staff ada@a.test',
      'staff tunde@a.test',
    ])
    expect((detail.body.booking.collectedByUserId as { name: string }).name).toBe('staff tunde@a.test')
  })

  it('refuses to hand over laundry while a balance is outstanding', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const id = await readyBooking(t, { paidMinor: 10000, paymentMethod: 'transfer' })

    const collect = await api.post<Res>(`/bookings/${id}/collect`, {}, t.ownerToken)
    expect(collect.status).toBe(409)
    expect(collect.body.error).toMatch(/400\.00 outstanding/)

    const viaStatus = await api.patch<Res>(`/bookings/${id}/status`, { status: 'collected' }, t.ownerToken)
    expect(viaStatus.status).toBe(400)

    // Paid in full beforehand, it can be handed over with no payment.
    await api.post(`/bookings/${id}/payments`, { amountMinor: 40000, method: 'cash' }, t.ownerToken)
    const ok = await api.post<Res>(`/bookings/${id}/collect`, {}, t.ownerToken)
    expect(ok.status).toBe(200)
    expect(ok.body.booking.payments.map((p) => p.stage)).toEqual(['deposit', 'balance'])
  })

  it('caps payments at the total and requires a mode of payment', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    await expect(makeBooking(api, t, '08031234567', { paidMinor: 50001, paymentMethod: 'cash' })).rejects.toThrow(
      /exceeds the booking total/,
    )
    await expect(makeBooking(api, t, '08031234567', { paidMinor: 100 })).rejects.toThrow(/how the customer paid/)

    const booking = await makeBooking(api, t, '08031234567', { paidMinor: 50000, paymentMethod: 'pos' })
    const over = await api.post<Res>(`/bookings/${booking._id}/payments`, { amountMinor: 1, method: 'cash' }, t.ownerToken)
    expect(over.status).toBe(400)

    const unrecorded = await api.post<Res>(
      `/bookings/${booking._id}/payments`,
      { amountMinor: 1, method: 'unrecorded' },
      t.ownerToken,
    )
    expect(unrecorded.status).toBe(400)
  })

  it('lets only one of two simultaneous balance payments through', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const booking = await makeBooking(api, t)
    const pay = () =>
      api.post<Res>(`/bookings/${booking._id}/payments`, { amountMinor: 50000, method: 'cash' }, t.ownerToken)

    const results = await Promise.all([pay(), pay(), pay()])
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)

    const detail = await api.get<Res>(`/bookings/${booking._id}`, t.ownerToken)
    expect(detail.body.booking.paidMinor).toBe(50000)
    expect(detail.body.booking.payments).toHaveLength(1)
  })

  it('records a retried payment once', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const booking = await makeBooking(api, t)
    const body = { amountMinor: 10000, method: 'cash', clientRequestId: 'retry-key-0001' }

    await api.post(`/bookings/${booking._id}/payments`, body, t.ownerToken)
    const again = await api.post<Res>(`/bookings/${booking._id}/payments`, body, t.ownerToken)
    expect(again.status).toBe(200)
    expect(again.body.booking.paidMinor).toBe(10000)
    expect(again.body.booking.payments).toHaveLength(1)
  })

  it('needs a manager and a refund to cancel a booking holding money', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const staff = await makeUser(api, t, 'staff', 'staff@a.test')
    const manager = await makeUser(api, t, 'manager', 'manager@a.test')
    const booking = await makeBooking(api, t, '08031234567', { paidMinor: 20000, paymentMethod: 'cash' })
    const url = `/bookings/${booking._id}/status`

    expect((await api.patch(url, { status: 'cancelled', refund: { method: 'cash' } }, staff.token)).status).toBe(403)
    expect((await api.patch(url, { status: 'cancelled' }, manager.token)).status).toBe(400)

    const cancelled = await api.patch<Res>(
      url,
      { status: 'cancelled', refund: { method: 'transfer', note: 'Customer changed mind' } },
      manager.token,
    )
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.booking.paidMinor).toBe(0)
    expect(cancelled.body.booking.payments[1]).toMatchObject({
      kind: 'refund',
      amountMinor: 20000,
      method: 'transfer',
      stage: 'refund',
      byUserId: manager.userId,
    })

    // No more money moves on a cancelled booking.
    const pay = await api.post(`/bookings/${booking._id}/payments`, { amountMinor: 100, method: 'cash' }, t.ownerToken)
    expect(pay.status).toBe(400)
  })

  it('staff may still cancel an unpaid booking', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const staff = await makeUser(api, t, 'staff', 'staff@a.test')
    const booking = await makeBooking(api, t)
    const res = await api.patch(`/bookings/${booking._id}/status`, { status: 'cancelled' }, staff.token)
    expect(res.status).toBe(200)
  })

  it('takes no payment once collected', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const id = await readyBooking(t)
    await api.post(`/bookings/${id}/collect`, { payment: { method: 'cash' } }, t.ownerToken)
    const pay = await api.post<Res>(`/bookings/${id}/payments`, { amountMinor: 1, method: 'cash' }, t.ownerToken)
    expect(pay.status).toBe(400)
  })

  it('lets a balance left on a pre-ledger handover be settled, and counts it as owed', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const booking = await makeBooking(api, t, '08031234567', { paidMinor: 10000, paymentMethod: 'cash' })
    // Under the old rules laundry could leave owing; simulate that state.
    await BookingModel.collection.updateOne(
      { _id: new Types.ObjectId(booking._id) },
      { $set: { status: 'collected', collectedAt: new Date() } },
    )

    const summary = await api.get<{ summary: { outstanding: { outstandingMinor: number } } }>(
      '/dashboard/summary',
      t.ownerToken,
    )
    expect(summary.body.summary.outstanding.outstandingMinor).toBe(40000)

    const pay = await api.post<Res>(`/bookings/${booking._id}/payments`, { amountMinor: 40000, method: 'transfer' }, t.ownerToken)
    expect(pay.status).toBe(200)
    expect(pay.body.booking.paymentStatus).toBe('paid')
  })

  it('keeps payment and collection inside the staff member’s branches', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const branch = await api.post<{ branch: { _id: string } }>('/branches', { name: 'Branch 1' }, t.ownerToken)
    const elsewhere = await makeUser(api, t, 'staff', 'b1@a.test', [branch.body.branch._id])
    const id = await readyBooking(t)

    expect((await api.post(`/bookings/${id}/payments`, { amountMinor: 100, method: 'cash' }, elsewhere.token)).status).toBe(403)
    expect((await api.post(`/bookings/${id}/collect`, { payment: { method: 'cash' } }, elsewhere.token)).status).toBe(403)
    expect((await api.get(`/bookings/${id}`, elsewhere.token)).status).toBe(403)
  })
})
