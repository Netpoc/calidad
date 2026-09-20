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

describe('dashboards count only their own business', () => {
  it('headline figures and branch breakdown are tenant-scoped', async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    await makeBooking(api, a)
    await makeBooking(api, b)
    await makeBooking(api, b, '08000000009')

    const summaryA = await api.get<{ summary: { day: { bookingCount: number; billedMinor: number } } }>(
      '/dashboard/summary', a.ownerToken)
    const summaryB = await api.get<{ summary: { day: { bookingCount: number } } }>(
      '/dashboard/summary', b.ownerToken)
    expect(summaryA.body.summary.day.bookingCount).toBe(1)
    expect(summaryA.body.summary.day.billedMinor).toBe(50000)
    expect(summaryB.body.summary.day.bookingCount).toBe(2)

    const from = new Date(Date.now() - 86_400_000).toISOString()
    const to = new Date(Date.now() + 86_400_000).toISOString()
    const byBranch = await api.get<{ branches: Array<{ branchId: string; bookingCount: number }> }>(
      `/dashboard/branches?from=${from}&to=${to}`, a.ownerToken)
    expect(byBranch.body.branches).toHaveLength(1)
    expect(byBranch.body.branches[0]).toMatchObject({ branchId: a.hqId, bookingCount: 1 })
  })
})
