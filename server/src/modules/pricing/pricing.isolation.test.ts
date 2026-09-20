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

describe('price lists and branches are per business', () => {
  it('a new business starts with an empty price list and only HQ', async () => {
    const t = await makeTenant(api, 'New', 'n@n.test')
    const pricing = await api.get<{ items: unknown[] }>('/pricing', t.ownerToken)
    const branches = await api.get<{ branches: Array<{ name: string }> }>('/branches', t.ownerToken)
    expect(pricing.body.items).toEqual([])
    expect(branches.body.branches.map((b) => b.name)).toEqual(['HQ'])
  })

  it('two businesses can both have a "Shirt"', async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    const item = { name: 'Shirt', category: 'tops', washStarchIronMinor: 50000 }
    expect((await api.post('/pricing', item, a.ownerToken)).status).toBe(201)
    expect((await api.post('/pricing', item, b.ownerToken)).status).toBe(201)
    // But not the same business twice.
    expect((await api.post('/pricing', item, a.ownerToken)).status).toBe(409)
  })

  it("another business's price item cannot be booked or edited", async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    const { itemId } = await makeBooking(api, a)

    const book = await api.post<{ error: string }>(
      '/bookings',
      {
        branchId: b.hqId,
        customer: { name: 'X', phone: '08000000002' },
        items: [{ priceItemId: itemId, tier: 'wash_starch_iron', quantity: 1 }],
      },
      b.ownerToken,
    )
    expect(book.status).toBe(400)
    expect(book.body.error).toMatch(/Unknown or inactive price item/)

    const edit = await api.patch(`/pricing/${itemId}`, { washStarchIronMinor: 1 }, b.ownerToken)
    expect(edit.status).toBe(404)
  })

  it("another business's branch cannot be edited, and a miss is a 404 not null", async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')

    const res = await api.patch<{ branch?: unknown }>(`/branches/${a.hqId}`, { name: 'Pwned' }, b.ownerToken)
    expect(res.status).toBe(404)
    expect(res.body).not.toHaveProperty('branch')

    const branches = await api.get<{ branches: Array<{ name: string }> }>('/branches', a.ownerToken)
    expect(branches.body.branches[0]!.name).toBe('HQ')
  })

  it('a price list scoped to a foreign branch is refused', async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    const res = await api.post(
      '/pricing',
      { name: 'Towel', washStarchIronMinor: 1000, branchId: b.hqId },
      a.ownerToken,
    )
    expect(res.status).toBe(400)
  })
})
