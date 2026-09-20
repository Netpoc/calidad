import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { makeBooking, makeTenant } from '../../test/fixtures.js'
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

describe('bookings never cross businesses', () => {
  it('a reference code from another business is a 404, not a leak', async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    const booking = await makeBooking(api, a)

    expect((await api.get(`/bookings/reference/${booking.referenceCode}`, a.ownerToken)).status).toBe(200)
    expect((await api.get(`/bookings/reference/${booking.referenceCode}`, b.ownerToken)).status).toBe(404)
  })

  it("an OWNER of another business cannot change status or take payment by id", async () => {
    // Owners used to skip the scope lookup entirely — this was the hole.
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    const booking = await makeBooking(api, a)

    const status = await api.patch(`/bookings/${booking._id}/status`, { status: 'in_progress' }, b.ownerToken)
    const payment = await api.post(`/bookings/${booking._id}/payments`, { amountMinor: 100 }, b.ownerToken)
    expect(status.status).toBe(404)
    expect(payment.status).toBe(404)

    // And the rightful owner still can.
    expect((await api.patch(`/bookings/${booking._id}/status`, { status: 'in_progress' }, a.ownerToken)).status).toBe(200)
  })

  it("lists exclude the other business", async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    await makeBooking(api, a)
    await makeBooking(api, b)

    const fromA = await api.get<{ bookings: Array<{ referenceCode: string }> }>('/bookings', a.ownerToken)
    const fromB = await api.get<{ bookings: Array<{ referenceCode: string }> }>('/bookings', b.ownerToken)
    expect(fromA.body.bookings).toHaveLength(1)
    expect(fromB.body.bookings).toHaveLength(1)
    expect(fromA.body.bookings[0]!.referenceCode).not.toBe(fromB.body.bookings[0]!.referenceCode)
  })

  it("an owner cannot book into another business's branch", async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    const { itemId } = await makeBooking(api, a)

    const res = await api.post(
      '/bookings',
      {
        branchId: b.hqId,
        customer: { name: 'X', phone: '08000000001' },
        items: [{ priceItemId: itemId, tier: 'wash_starch_iron', quantity: 1 }],
      },
      a.ownerToken,
    )
    expect(res.status).toBe(404)
  })

  it('offline replay dedupes within a business and only within it', async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    const { itemId: aItem } = await makeBooking(api, a)
    const { itemId: bItem } = await makeBooking(api, b)
    const clientRequestId = 'same-id-on-two-phones'

    const entry = (branchId: string, itemId: string) => ({
      clientRequestId,
      branchId,
      customer: { name: 'Sync', phone: '08099990000' },
      items: [{ priceItemId: itemId, tier: 'wash_starch_iron', quantity: 1 }],
    })

    const first = await api.post<{ results: Array<{ status: string }> }>(
      '/bookings/sync', { bookings: [entry(a.hqId, aItem)] }, a.ownerToken)
    const replay = await api.post<{ results: Array<{ status: string }> }>(
      '/bookings/sync', { bookings: [entry(a.hqId, aItem)] }, a.ownerToken)
    const other = await api.post<{ results: Array<{ status: string }> }>(
      '/bookings/sync', { bookings: [entry(b.hqId, bItem)] }, b.ownerToken)

    expect(first.body.results[0]!.status).toBe('created')
    expect(replay.body.results[0]!.status).toBe('duplicate')
    // Same client id at a different business is a different booking, never a
    // "duplicate" that would hand back the first business's record.
    expect(other.body.results[0]!.status).toBe('created')
  })
})
