import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { makeTenant } from '../../test/fixtures.js'
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

interface Item {
  _id: string
  washStarchIronMinor: number | null
  starchIronMinor: number | null
  ironOnlyMinor: number | null
}

describe('Iron Only tier', () => {
  it('can be the only service an item offers', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const res = await api.post<{ item: Item }>(
      '/pricing',
      { name: 'Agbada', ironOnlyMinor: 40000 },
      t.ownerToken,
    )
    expect(res.status).toBe(201)
    expect(res.body.item).toMatchObject({
      washStarchIronMinor: null,
      starchIronMinor: null,
      ironOnlyMinor: 40000,
    })
  })

  it('books at its own price, separate from the other tiers', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const item = await api.post<{ item: Item }>(
      '/pricing',
      { name: 'Shirt', washStarchIronMinor: 50000, starchIronMinor: 30000, ironOnlyMinor: 20000 },
      t.ownerToken,
    )
    const booking = await api.post<{ booking: { totalMinor: number; items: Array<{ tier: string }> } }>(
      '/bookings',
      {
        branchId: t.hqId,
        customer: { name: 'Customer', phone: '08031234567' },
        items: [
          { priceItemId: item.body.item._id, tier: 'iron_only', quantity: 2 },
          { priceItemId: item.body.item._id, tier: 'starch_iron', quantity: 1 },
        ],
      },
      t.ownerToken,
    )
    expect(booking.status).toBe(201)
    expect(booking.body.booking.totalMinor).toBe(2 * 20000 + 30000)
    expect(booking.body.booking.items[0]!.tier).toBe('iron_only')
  })

  it('is refused when the item does not offer it', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const item = await api.post<{ item: Item }>(
      '/pricing',
      { name: 'Duvet', washStarchIronMinor: 300000 },
      t.ownerToken,
    )
    const booking = await api.post<{ error: string }>(
      '/bookings',
      {
        branchId: t.hqId,
        customer: { name: 'Customer', phone: '08031234567' },
        items: [{ priceItemId: item.body.item._id, tier: 'iron_only', quantity: 1 }],
      },
      t.ownerToken,
    )
    expect(booking.status).toBe(400)
    expect(booking.body.error).toContain('Iron Only')
  })

  it('clearing every tier, Iron Only included, is refused', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const item = await api.post<{ item: Item }>(
      '/pricing',
      { name: 'Agbada', ironOnlyMinor: 40000 },
      t.ownerToken,
    )
    const res = await api.patch(`/pricing/${item.body.item._id}`, { ironOnlyMinor: null }, t.ownerToken)
    expect(res.status).toBe(400)
  })
})
