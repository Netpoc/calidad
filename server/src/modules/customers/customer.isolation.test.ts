import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CustomerModel } from './customer.model.js'
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

const PHONE = '08031234567'

describe('customers are separate per business', () => {
  it('the same phone at two businesses is two customers', async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    await makeBooking(api, a, PHONE)
    await makeBooking(api, b, PHONE)

    const customers = await CustomerModel.find({ phone: '+2348031234567' })
    expect(customers).toHaveLength(2)
    expect(new Set(customers.map((c) => c.customerId)).size).toBe(2)
    expect(new Set(customers.map((c) => c.tenantId.toString()))).toEqual(
      new Set([a.tenantId, b.tenantId]),
    )
  })

  it('the same phone twice at one business is still one customer', async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const first = await makeBooking(api, a, PHONE)
    const second = await makeBooking(api, a, '+234 803 123 4567')

    expect(await CustomerModel.countDocuments({ tenantId: a.tenantId })).toBe(1)
    expect(first.referenceCode).not.toBe(second.referenceCode)
  })

  it("search never finds another business's customer", async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    await makeBooking(api, a, PHONE)

    const fromA = await api.get<{ customers: unknown[] }>(
      `/customers/search?q=${PHONE}`,
      a.ownerToken,
    )
    const fromB = await api.get<{ customers: unknown[] }>(
      `/customers/search?q=${PHONE}`,
      b.ownerToken,
    )
    expect(fromA.body.customers).toHaveLength(1)
    expect(fromB.body.customers).toHaveLength(0)
  })

  it("a customer id from another business is a plain 404", async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    await makeBooking(api, a, PHONE)
    const customer = await CustomerModel.findOne({ tenantId: a.tenantId })

    expect((await api.get(`/customers/${customer!._id}`, a.ownerToken)).status).toBe(200)
    expect((await api.get(`/customers/${customer!._id}`, b.ownerToken)).status).toBe(404)
  })
})
