import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../middleware/async-handler.js'
import { authenticate, requireRole } from '../../middleware/auth.js'
import { param } from '../../shared/http-error.js'
import { createTenantWithOwner, listTenantsWithCounts, updateTenant } from './tenant.service.js'

/**
 * Platform administration: the SaaS operator creating and managing businesses.
 * Deliberately no `requireTenant` — the platform admin has no tenant — and
 * nothing here reads inside a business's data beyond headline counts.
 */
const router = Router()
router.use(authenticate, requireRole('platform_admin'))

const ownerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
})

const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(80),
  owner: ownerSchema,
})

const updateTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.active !== undefined, {
    message: 'Nothing to update',
  })

router.get(
  '/tenants',
  asyncHandler(async (_req, res) => {
    res.json({ tenants: await listTenantsWithCounts() })
  }),
)

router.post(
  '/tenants',
  asyncHandler(async (req, res) => {
    const body = createTenantSchema.parse(req.body)
    const { tenant, hq, owner } = await createTenantWithOwner(body)

    // Never echo the password back, even to the admin who typed it.
    res.status(201).json({
      tenant: { id: tenant._id.toString(), name: tenant.name, active: tenant.active },
      hq: { id: hq._id.toString(), name: hq.name },
      owner: { id: owner._id.toString(), name: owner.name, email: owner.email },
    })
  }),
)

router.patch(
  '/tenants/:id',
  asyncHandler(async (req, res) => {
    const body = updateTenantSchema.parse(req.body)
    const tenant = await updateTenant(param(req, 'id'), body)
    res.json({ tenant: { id: tenant._id.toString(), name: tenant.name, active: tenant.active } })
  }),
)

export default router
