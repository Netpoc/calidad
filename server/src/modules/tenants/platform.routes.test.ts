import jwt from 'jsonwebtoken'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BranchModel } from '../branches/branch.model.js'
import { UserModel } from '../auth/user.model.js'
import { TenantModel } from './tenant.model.js'
import { PASSWORD, loginAs, makePlatformAdmin, makeTenant } from '../../test/fixtures.js'
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

const newBusiness = {
  name: 'Sparkle Wash',
  owner: { name: 'Ada', email: 'ada@sparkle.test', password: PASSWORD },
}

describe('platform routes', () => {
  it('refuses a business owner', async () => {
    const t = await makeTenant(api, 'A', 'a@a.test')
    const res = await api.get('/platform/tenants', t.ownerToken)
    expect(res.status).toBe(403)
  })

  it('creates a business with exactly one HQ and one owner', async () => {
    const admin = await makePlatformAdmin(api)
    const res = await api.post<{
      tenant: { id: string; name: string }
      hq: { name: string }
      owner: { email: string }
    }>('/platform/tenants', newBusiness, admin)

    expect(res.status).toBe(201)
    expect(res.body.hq.name).toBe('HQ')
    expect(res.body.owner.email).toBe('ada@sparkle.test')
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD)

    const tenantId = res.body.tenant.id
    expect(await BranchModel.countDocuments({ tenantId })).toBe(1)
    expect(await BranchModel.findOne({ tenantId }).then((b) => b?.isHeadquarters)).toBe(true)
    const owner = await UserModel.findOne({ tenantId })
    expect(owner?.role).toBe('owner')
    expect(owner?.tenantId?.toString()).toBe(tenantId)
  })

  it('rejects a taken owner email and leaves no orphan business', async () => {
    const admin = await makePlatformAdmin(api)
    await makeTenant(api, 'First', 'ada@sparkle.test')
    const before = await TenantModel.countDocuments()

    const res = await api.post('/platform/tenants', newBusiness, admin)

    expect(res.status).toBe(409)
    expect(await TenantModel.countDocuments()).toBe(before)
    expect(await BranchModel.countDocuments({ name: 'HQ' })).toBe(1)
  })

  it('deactivation locks out new logins AND already-issued tokens', async () => {
    const admin = await makePlatformAdmin(api)
    const t = await makeTenant(api, 'Sparkle', 'ada@sparkle.test')
    expect((await api.get('/bookings', t.ownerToken)).status).toBe(200)

    const patch = await api.patch(`/platform/tenants/${t.tenantId}`, { active: false }, admin)
    expect(patch.status).toBe(200)

    const login = await api.post<{ error: string }>('/auth/login', {
      email: t.ownerEmail,
      password: PASSWORD,
    })
    expect(login.status).toBe(403)
    expect(login.body.error).toMatch(/deactivated/)

    // The old token is still cryptographically valid for 7 days. It must be
    // refused anyway — that is the point of checking the tenant per request.
    const withOldToken = await api.get<{ error: string }>('/bookings', t.ownerToken)
    expect(withOldToken.status).toBe(403)
    expect(withOldToken.body.error).toMatch(/deactivated/)

    await api.patch(`/platform/tenants/${t.tenantId}`, { active: true }, admin)
    expect((await api.get('/bookings', t.ownerToken)).status).toBe(200)
  })

  it('lists businesses with counts', async () => {
    const admin = await makePlatformAdmin(api)
    await makeTenant(api, 'One', 'one@t.test')
    await makeTenant(api, 'Two', 'two@t.test')

    const res = await api.get<{
      tenants: Array<{ name: string; counts: { users: number; branches: number } }>
    }>('/platform/tenants', admin)

    expect(res.status).toBe(200)
    expect(res.body.tenants.map((t) => t.name).sort()).toEqual(['One', 'Two'])
    for (const t of res.body.tenants) {
      expect(t.counts).toMatchObject({ users: 1, branches: 1 })
    }
  })

  it('platform admin login carries no tenant', async () => {
    await makePlatformAdmin(api)
    const res = await api.post<{ user: { role: string; tenantId: null }; tenant: null }>(
      '/auth/login',
      { email: 'admin@platform.test', password: PASSWORD },
    )
    expect(res.body.user.role).toBe('platform_admin')
    expect(res.body.user.tenantId).toBeNull()
    expect(res.body.tenant).toBeNull()
  })

  it('a token minted before tenants existed cannot enter a business', async () => {
    // Such a token verifies fine but has no tenantId at all (undefined, not
    // null). It must be refused, not treated as "any tenant".
    const t = await makeTenant(api, 'A', 'a@a.test')
    const owner = await UserModel.findOne({ email: 'a@a.test' })
    const stale = jwt.sign(
      { userId: owner!._id.toString(), role: 'owner', branchIds: [] },
      process.env.JWT_SECRET!,
    )

    expect((await api.get('/bookings', stale)).status).toBe(403)
    expect((await api.get('/bookings', await loginAs(api, t.ownerEmail))).status).toBe(200)
  })
})
