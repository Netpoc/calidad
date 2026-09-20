import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../middleware/async-handler.js'
import { authenticate, readableBranchIds, requireRole } from '../../middleware/auth.js'
import { requireTenant, tenantOf } from '../../middleware/tenant.js'
import { HttpError, param } from '../../shared/http-error.js'
import { BranchModel } from './branch.model.js'

const router = Router()
router.use(authenticate, requireTenant)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = readableBranchIds(req.auth!)
    const filter = { tenantId: tenantOf(req), ...(scope === null ? {} : { _id: { $in: scope } }) }
    const branches = await BranchModel.find(filter).sort({ isHeadquarters: -1, name: 1 })
    res.json({ branches })
  }),
)

const branchSchema = z.object({
  name: z.string().min(1),
  isHeadquarters: z.boolean().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
})

/** Only the owner creates branches (CLAUDE.md). */
router.post(
  '/',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const branch = await BranchModel.create({ ...branchSchema.parse(req.body), tenantId: tenantOf(req) })
    res.status(201).json({ branch })
  }),
)

router.patch(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const body = branchSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body)
    const branch = await BranchModel.findOneAndUpdate(
      { _id: param(req, 'id'), tenantId: tenantOf(req) },
      body,
      { new: true },
    )
    // A miss must be a 404, not `{ branch: null }` — otherwise this endpoint
    // becomes a way to probe whether another business's branch id exists.
    if (!branch) throw new HttpError(404, 'Branch not found')
    res.json({ branch })
  }),
)

export default router
