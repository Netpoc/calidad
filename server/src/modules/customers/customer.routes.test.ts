import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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

interface Stats {
  bookingCount: number
  billedMinor: number
  outstandingMinor: number
}
interface SearchResult {
  exactPhone: boolean
  customers: Array<{ _id: string; name: string; stats: Stats }>
}
interface History {
  bookings: Array<{ referenceCode: string }>
  stats: Stats
}

describe('customer search', () => {
  it('matches part of a phone number typed in local form', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    await makeBooking(api, t, '08031234567')
    await makeBooking(api, t, '08099990000')

    const tail = await api.get<SearchResult>('/customers/search?q=4567', t.ownerToken)
    expect(tail.body.customers).toHaveLength(1)

    const local = await api.get<SearchResult>('/customers/search?q=0803123', t.ownerToken)
    expect(local.body.customers).toHaveLength(1)
    // A partial hit must not be mistaken for the number — the booking form
    // auto-fills only on an exact match.
    expect(local.body.exactPhone).toBe(false)

    const full = await api.get<SearchResult>('/customers/search?q=0803 123 4567', t.ownerToken)
    expect(full.body.exactPhone).toBe(true)

    // Too short to mean anything — no blanket match on a single digit.
    const short = await api.get<SearchResult>('/customers/search?q=0', t.ownerToken)
    expect(short.body.customers).toHaveLength(0)
  })

  it('finds the customer behind a ticket reference', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const booking = await makeBooking(api, t, '08031234567')

    const res = await api.get<SearchResult>(
      `/customers/search?q=${booking.referenceCode.toLowerCase()}`,
      t.ownerToken,
    )
    expect(res.body.customers).toHaveLength(1)
  })

  it('returns visit stats with each match', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    await makeBooking(api, t, '08031234567')
    await makeBooking(api, t, '08031234567', { paidMinor: 50000, paymentMethod: 'cash' })

    const res = await api.get<SearchResult>('/customers/search?q=08031234567', t.ownerToken)
    expect(res.body.customers[0]!.stats).toMatchObject({
      bookingCount: 2,
      billedMinor: 100000,
      outstandingMinor: 50000,
    })
  })
})

describe('customer history', () => {
  it('returns every booking, not just a recent page', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    for (let i = 0; i < 55; i++) await makeBooking(api, t, '08031234567')

    const search = await api.get<SearchResult>('/customers/search?q=08031234567', t.ownerToken)
    const res = await api.get<History>(`/customers/${search.body.customers[0]!._id}`, t.ownerToken)
    expect(res.body.bookings).toHaveLength(55)
    expect(res.body.stats.bookingCount).toBe(55)
  })

  it("shows staff only their own branches' bookings for a shared customer", async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const branch = await api.post<{ branch: { _id: string } }>(
      '/branches',
      { name: 'Branch 1' },
      t.ownerToken,
    )
    const branchId = branch.body.branch._id
    await makeBooking(api, t, '08031234567')
    await makeBooking(api, t, '08031234567', { branchId })

    const staff = await makeUser(api, t, 'staff', 'staff@a.test', [branchId])
    const search = await api.get<SearchResult>('/customers/search?q=08031234567', staff.token)
    const customer = search.body.customers[0]!
    expect(customer.stats.bookingCount).toBe(1)

    const asStaff = await api.get<History>(`/customers/${customer._id}`, staff.token)
    expect(asStaff.body.bookings).toHaveLength(1)

    const asOwner = await api.get<History>(`/customers/${customer._id}`, t.ownerToken)
    expect(asOwner.body.bookings).toHaveLength(2)
  })
})
