import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PASSWORD, makePlatformAdmin, makeTenant } from '../../test/fixtures.js'
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

describe('who may go where', () => {
  it('owner login returns the business', async () => {
    const t = await makeTenant(api, 'Sparkle Wash', 'ada@sparkle.test')
    const res = await api.post<{ tenant: { id: string; name: string } }>('/auth/login', {
      email: t.ownerEmail,
      password: PASSWORD,
    })
    expect(res.body.tenant).toEqual({ id: t.tenantId, name: 'Sparkle Wash' })
  })

  it('platform admin is refused on every business route', async () => {
    const admin = await makePlatformAdmin(api)
    for (const path of [
      '/bookings',
      '/customers/search?q=0803',
      '/branches',
      '/pricing',
      '/auth/users',
      '/dashboard/summary',
    ]) {
      const res = await api.get<{ error: string }>(path, admin)
      expect(res.status, path).toBe(403)
      expect(res.body.error, path).toMatch(/not attached to a business/)
    }
  })

  it('an owner cannot mint a platform admin', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const res = await api.post(
      '/auth/users',
      { name: 'X', email: 'x@a.test', password: PASSWORD, role: 'platform_admin' },
      t.ownerToken,
    )
    expect(res.status).toBe(400)
  })

  it("an owner cannot attach staff to another business's branch", async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    const res = await api.post<{ error: string }>(
      '/auth/users',
      { name: 'X', email: 'x@a.test', password: PASSWORD, role: 'staff', branchIds: [b.hqId] },
      a.ownerToken,
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/do not belong to this business/)
  })

  it('user lists never cross businesses', async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    await api.post(
      '/auth/users',
      { name: 'A staff', email: 'staff@a.test', password: PASSWORD, role: 'staff', branchIds: [a.hqId] },
      a.ownerToken,
    )

    const res = await api.get<{ users: Array<{ email: string }> }>('/auth/users', b.ownerToken)
    const emails = res.body.users.map((u) => u.email)
    expect(emails).toEqual(['b@b.test'])
    expect(emails).not.toContain('staff@a.test')
  })

  it("an owner cannot edit another business's user by id", async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const b = await makeTenant(api, 'B', 'b@b.test')
    const bUsers = await api.get<{ users: Array<{ _id: string }> }>('/auth/users', b.ownerToken)
    const bOwnerId = bUsers.body.users[0]!._id

    const res = await api.patch(`/auth/users/${bOwnerId}`, { active: false }, a.ownerToken)
    expect(res.status).toBe(404)
  })

  it('a malformed id is a 400, not a crash', async () => {
    const a = await makeTenant(api, 'A', 'a@a.test')
    const res = await api.patch('/auth/users/not-an-id', { active: false }, a.ownerToken)
    expect(res.status).toBe(400)
  })
})
