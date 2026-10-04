import { Router } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { asyncHandler } from '../../middleware/async-handler.js'
import { authenticate, requireRole } from '../../middleware/auth.js'
import { readScopeFor, requireTenant, tenantOf } from '../../middleware/tenant.js'
import { LEDGER_METHODS } from '../../shared/domain.js'
import { HttpError } from '../../shared/http-error.js'
import { tillReport } from './payments.service.js'

const router = Router()
/** Who took which money is for managers and owners, like the dashboard. */
router.use(authenticate, requireTenant, requireRole('manager'))

const MAX_RANGE_MS = 93 * 24 * 60 * 60 * 1000

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  method: z.enum(LEDGER_METHODS).optional(),
  userId: z
    .string()
    .refine((id) => Types.ObjectId.isValid(id), 'Invalid user id')
    .optional(),
})

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { from, to, method, userId } = querySchema.parse(req.query)
    if (from >= to) throw new HttpError(400, '`from` must be before `to`')
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new HttpError(400, 'Pick a range of three months or less')
    }

    const report = await tillReport({
      tenantId: tenantOf(req),
      branchIds: readScopeFor(req),
      from,
      to,
      method,
      userId,
    })
    res.json(report)
  }),
)

export default router
