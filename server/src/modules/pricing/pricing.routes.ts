import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../middleware/async-handler.js'
import { authenticate, requireRole } from '../../middleware/auth.js'
import { HttpError } from '../../shared/http-error.js'
import { PriceItemModel } from './price-item.model.js'

const router = Router()
router.use(authenticate)

/**
 * The price list every client caches for offline booking. Branch-specific
 * entries override the global list of the same name.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : null
    const items = await PriceItemModel.find({
      active: true,
      $or: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])],
    }).sort({ sortOrder: 1, name: 1 })

    const byName = new Map<string, (typeof items)[number]>()
    for (const item of items) {
      const existing = byName.get(item.name)
      if (!existing || item.branchId) byName.set(item.name, item)
    }

    res.json({ items: [...byName.values()], updatedAt: new Date().toISOString() })
  }),
)

/** `null` clears a tier — meaning "not offered" — while omitting it leaves it. */
const priceSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  washStarchIronMinor: z.number().int().min(0).nullable().optional(),
  starchIronMinor: z.number().int().min(0).nullable().optional(),
  branchId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
})

/** Only the owner edits price lists (CLAUDE.md). */
router.post(
  '/',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const body = priceSchema.parse(req.body)
    if (body.washStarchIronMinor == null && body.starchIronMinor == null) {
      throw new HttpError(400, 'A price item must offer at least one service tier')
    }
    const item = await PriceItemModel.create(body)
    res.status(201).json({ item })
  }),
)

router.patch(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const body = priceSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body)
    const item = await PriceItemModel.findById(req.params.id)
    if (!item) throw new HttpError(404, 'Price item not found')

    item.set(body)
    await item.save() // pre-validate enforces the at-least-one-tier rule
    res.json({ item })
  }),
)

export default router
