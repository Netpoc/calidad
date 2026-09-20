import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../middleware/async-handler.js'
import { authenticate, requireRole, signToken } from '../../middleware/auth.js'
import { assertBranchesInTenant, requireTenant, tenantOf } from '../../middleware/tenant.js'
import { TENANT_ROLES, type Role } from '../../shared/domain.js'
import { HttpError, param } from '../../shared/http-error.js'
import { TenantModel } from '../tenants/tenant.model.js'
import { UserModel, hashPassword } from './user.model.js'

const router = Router()

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(req.body)

    const user = await UserModel.findOne({ email: email.toLowerCase() }).select('+passwordHash')
    // Same message either way: revealing which half was wrong helps an attacker
    // enumerate staff accounts.
    if (!user || !user.active || !(await user.verifyPassword(password))) {
      throw new HttpError(401, 'Invalid email or password')
    }

    // A business user's tenant must exist and be active. 403 rather than 401
    // so the client shows the message instead of treating it as a bad token.
    let tenant: { id: string; name: string } | null = null
    if (user.role !== 'platform_admin') {
      const doc = user.tenantId ? await TenantModel.findById(user.tenantId) : null
      if (!doc || !doc.active) throw new HttpError(403, 'This business has been deactivated')
      tenant = { id: doc._id.toString(), name: doc.name }
    }

    const token = signToken({
      userId: user._id.toString(),
      role: user.role as Role,
      tenantId: tenant?.id ?? null,
      branchIds: user.branchIds.map((id) => id.toString()),
    })

    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: tenant?.id ?? null,
        branchIds: user.branchIds,
      },
      tenant,
    })
  }),
)

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.auth!.userId).populate('branchIds', 'name')
    if (!user) throw new HttpError(404, 'User not found')
    res.json({ user })
  }),
)

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  // TENANT_ROLES, not ROLES: a platform admin can never be minted from inside a business.
  role: z.enum(TENANT_ROLES),
  phone: z.string().optional(),
  branchIds: z.array(z.string()).default([]),
})

/**
 * The owner creates any user; a manager may create staff, but only staff and
 * only inside the branches they already manage (CLAUDE.md: "managers manage
 * staff under his/her branch"). A manager must never be able to mint another
 * manager or widen their own scope by assigning a branch they do not hold.
 */
router.post(
  '/users',
  authenticate,
  requireTenant,
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body)
    const auth = req.auth!
    const tenantId = tenantOf(req)

    if (auth.role !== 'owner') {
      if (body.role !== 'staff') {
        throw new HttpError(403, 'Managers can only create staff accounts')
      }
      const outside = body.branchIds.filter((id) => !auth.branchIds.includes(id))
      if (outside.length > 0) {
        throw new HttpError(403, 'You can only assign branches you manage')
      }
      if (body.branchIds.length === 0) {
        throw new HttpError(400, 'Assign at least one branch')
      }
    }

    if (body.role !== 'owner' && body.role !== 'customer' && body.branchIds.length === 0) {
      throw new HttpError(400, 'Managers and staff must be assigned at least one branch')
    }

    // The token will carry these branch ids and resolveBranchScope trusts
    // them, so they must be proven to belong to this business.
    await assertBranchesInTenant(tenantId, body.branchIds)

    const user = await UserModel.create({
      tenantId,
      name: body.name,
      email: body.email,
      phone: body.phone ?? '',
      passwordHash: await hashPassword(body.password),
      role: body.role,
      branchIds: body.branchIds,
    })

    res.status(201).json({
      user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role },
    })
  }),
)

/** Deactivating rather than deleting keeps the audit trail on past bookings. */
router.patch(
  '/users/:id',
  authenticate,
  requireTenant,
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1).optional(),
        phone: z.string().optional(),
        active: z.boolean().optional(),
        branchIds: z.array(z.string()).optional(),
      })
      .parse(req.body)

    const auth = req.auth!
    const tenantId = tenantOf(req)
    const target = await UserModel.findOne({ _id: param(req, 'id'), tenantId })
    if (!target) throw new HttpError(404, 'User not found')
    if (body.branchIds) await assertBranchesInTenant(tenantId, body.branchIds)

    if (auth.role !== 'owner') {
      if (target.role !== 'staff') {
        throw new HttpError(403, 'Managers can only manage staff accounts')
      }
      const shared = target.branchIds.some((id) => auth.branchIds.includes(id.toString()))
      if (!shared) throw new HttpError(403, 'That staff member is outside your branches')
      if (body.branchIds?.some((id) => !auth.branchIds.includes(id))) {
        throw new HttpError(403, 'You can only assign branches you manage')
      }
    }

    if (target._id.toString() === auth.userId && body.active === false) {
      throw new HttpError(400, 'You cannot deactivate your own account')
    }

    target.set(body)
    await target.save()
    res.json({ user: target })
  }),
)

router.get(
  '/users',
  authenticate,
  requireTenant,
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    // Always the caller's business; a manager additionally sees only their branches.
    const filter: Record<string, unknown> = { tenantId: tenantOf(req) }
    if (req.auth!.role !== 'owner') filter.branchIds = { $in: req.auth!.branchIds }

    const users = await UserModel.find(filter).populate('branchIds', 'name').sort({ name: 1 })
    res.json({ users })
  }),
)

export default router
