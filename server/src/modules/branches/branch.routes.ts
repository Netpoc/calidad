import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../middleware/async-handler.js'
import { authenticate, readableBranchIds, requireRole } from '../../middleware/auth.js'
import { BranchModel } from './branch.model.js'

const router = Router()
router.use(authenticate)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = readableBranchIds(req.auth!)
    const filter = scope === null ? {} : { _id: { $in: scope } }
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
    const branch = await BranchModel.create(branchSchema.parse(req.body))
    res.status(201).json({ branch })
  }),
)

router.patch(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const body = branchSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body)
    const branch = await BranchModel.findByIdAndUpdate(req.params.id, body, { new: true })
    res.json({ branch })
  }),
)

export default router
