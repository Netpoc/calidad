import { UserModel, hashPassword } from '../modules/auth/user.model.js'
import { createTenantWithOwner } from '../modules/tenants/tenant.service.js'
import type { Api } from './http.js'

export const PASSWORD = 'password-123'

export async function makePlatformAdmin(api: Api, email = 'admin@platform.test') {
  await UserModel.create({
    tenantId: null,
    name: 'Admin',
    email,
    passwordHash: await hashPassword(PASSWORD),
    role: 'platform_admin',
    branchIds: [],
  })
  return loginAs(api, email)
}

export async function loginAs(api: Api, email: string, password = PASSWORD): Promise<string> {
  const res = await api.post<{ token?: string; error?: string }>('/auth/login', { email, password })
  if (!res.body.token) throw new Error(`login failed for ${email}: ${res.status} ${res.body.error}`)
  return res.body.token
}

export interface TenantFixture {
  tenantId: string
  hqId: string
  ownerEmail: string
  ownerToken: string
}

/** A business with its HQ and a logged-in owner, straight from the service. */
export async function makeTenant(api: Api, name: string, ownerEmail: string): Promise<TenantFixture> {
  const { tenant, hq } = await createTenantWithOwner({
    name,
    owner: { name: `${name} owner`, email: ownerEmail, password: PASSWORD },
  })
  return {
    tenantId: tenant._id.toString(),
    hqId: hq._id.toString(),
    ownerEmail,
    ownerToken: await loginAs(api, ownerEmail),
  }
}

/** The business's "Shirt" price item, created on first use. */
async function shirtFor(api: Api, t: TenantFixture): Promise<string> {
  const list = await api.get<{ items: Array<{ _id: string; name: string }> }>('/pricing', t.ownerToken)
  const existing = list.body.items.find((i) => i.name === 'Shirt')
  if (existing) return existing._id

  const created = await api.post<{ item: { _id: string } }>(
    '/pricing',
    { name: 'Shirt', category: 'tops', washStarchIronMinor: 50000 },
    t.ownerToken,
  )
  if (created.status !== 201) throw new Error(`price item failed: ${JSON.stringify(created.body)}`)
  return created.body.item._id
}

/** A booking of one Shirt, so isolation tests have real data. */
export async function makeBooking(api: Api, t: TenantFixture, phone = '08031234567') {
  const itemId = await shirtFor(api, t)
  const booking = await api.post<{ booking: { _id: string; referenceCode: string } }>(
    '/bookings',
    {
      branchId: t.hqId,
      customer: { name: 'Customer', phone },
      items: [{ priceItemId: itemId, tier: 'wash_starch_iron', quantity: 1 }],
    },
    t.ownerToken,
  )
  if (booking.status !== 201) throw new Error(`booking failed: ${JSON.stringify(booking.body)}`)
  return { itemId, ...booking.body.booking }
}
