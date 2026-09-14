import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../middleware/async-handler.js'
import { authenticate, requireRole, signToken } from '../../middleware/auth.js'
import { ROLES, type Role } from '../../shared/domain.js'
import { HttpError, param } from '../../shared/http-error.js'
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

    const token = signToken({
      userId: user._id.toString(),
      role: user.role as Role,
      branchIds: user.branchIds.map((id) => id.toString()),
    })

    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        branchIds: user.branchIds,
      },
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
  role: z.enum(ROLES),
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
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body)
    const auth = req.auth!

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

    const user = await UserModel.create({
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
    const target = await UserModel.findById(param(req, 'id'))
    if (!target) throw new HttpError(404, 'User not found')

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
  requireRole('manager'),
  asyncHandler(async (req, res) => {
    // A manager sees only staff in the branches they manage.
    const filter: Record<string, unknown> =
      req.auth!.role === 'owner' ? {} : { branchIds: { $in: req.auth!.branchIds } }

    const users = await UserModel.find(filter).populate('branchIds', 'name').sort({ name: 1 })
    res.json({ users })
  }),
)

export default router
