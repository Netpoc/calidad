import { Types } from 'mongoose'
import { invalidateTenantCache } from '../../middleware/tenant.js'
import { HttpError } from '../../shared/http-error.js'
import { UserModel, hashPassword, type UserDoc } from '../auth/user.model.js'
import { BookingModel } from '../bookings/booking.model.js'
import { BranchModel, type BranchDoc } from '../branches/branch.model.js'
import { TenantModel, type TenantDoc } from './tenant.model.js'

export interface CreateTenantInput {
  name: string
  owner: { name: string; email: string; password: string }
}

/**
 * Creates a business, its HQ branch, and its first owner as one operation.
 *
 * There are no transactions on a standalone Mongo, so the order matters: the
 * only check that can fail on user input (a taken email) runs before any
 * write, and if a later write still fails the earlier ones are rolled back by
 * hand so a half-created business never lingers.
 */
export async function createTenantWithOwner(
  input: CreateTenantInput,
): Promise<{ tenant: TenantDoc; hq: BranchDoc; owner: UserDoc }> {
  const email = input.owner.email.trim().toLowerCase()
  if (await UserModel.exists({ email })) {
    throw new HttpError(409, 'An account with that email already exists')
  }

  const tenant = await TenantModel.create({ name: input.name.trim() })
  let hq: BranchDoc | undefined
  try {
    hq = await BranchModel.create({ tenantId: tenant._id, name: 'HQ', isHeadquarters: true })
    const owner = await UserModel.create({
      tenantId: tenant._id,
      name: input.owner.name.trim(),
      email,
      passwordHash: await hashPassword(input.owner.password),
      role: 'owner',
      branchIds: [],
    })
    return { tenant, hq, owner }
  } catch (error) {
    await Promise.all([
      hq ? BranchModel.deleteOne({ _id: hq._id }) : Promise.resolve(),
      TenantModel.deleteOne({ _id: tenant._id }),
    ])
    throw error
  }
}

export interface TenantSummary {
  id: string
  name: string
  active: boolean
  createdAt: Date
  counts: { users: number; branches: number; bookings: number }
}

/** Every business with headline counts — the platform admin's overview. */
export async function listTenantsWithCounts(): Promise<TenantSummary[]> {
  const [tenants, users, branches, bookings] = await Promise.all([
    TenantModel.find().sort({ createdAt: -1 }).lean(),
    countBy(UserModel),
    countBy(BranchModel),
    countBy(BookingModel),
  ])

  return tenants.map((tenant) => {
    const id = tenant._id.toString()
    return {
      id,
      name: tenant.name,
      active: tenant.active,
      createdAt: tenant.createdAt,
      counts: {
        users: users.get(id) ?? 0,
        branches: branches.get(id) ?? 0,
        bookings: bookings.get(id) ?? 0,
      },
    }
  })
}

async function countBy(model: {
  aggregate(pipeline: object[]): { exec(): Promise<Array<{ _id: Types.ObjectId | null; n: number }>> }
}): Promise<Map<string, number>> {
  const rows = await model
    .aggregate([{ $match: { tenantId: { $ne: null } } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }])
    .exec()
  return new Map(rows.filter((r) => r._id).map((r) => [r._id!.toString(), r.n]))
}

export async function updateTenant(
  id: string,
  patch: { name?: string; active?: boolean },
): Promise<TenantDoc> {
  const tenant = await TenantModel.findByIdAndUpdate(id, patch, { new: true })
  if (!tenant) throw new HttpError(404, 'Business not found')
  // Deactivation must be felt by already-issued tokens, not just new logins.
  invalidateTenantCache(id)
  return tenant
}
