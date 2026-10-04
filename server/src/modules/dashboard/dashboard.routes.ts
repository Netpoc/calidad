import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../middleware/async-handler.js'
import { authenticate, requireRole } from '../../middleware/auth.js'
import { readScopeFor, requireTenant, tenantOf } from '../../middleware/tenant.js'
import { HttpError } from '../../shared/http-error.js'
import { byBranch, headline, timeSeries } from './dashboard.service.js'

const router = Router()
/** Dashboards are for managers and owners (CLAUDE.md). */
router.use(authenticate, requireTenant, requireRole('manager'))

/** Day, month, and year to date — the three headline figures. */
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json({ summary: await headline({ tenantId: tenantOf(req), branchIds: readScopeFor(req) }) })
  }),
)

const rangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  period: z.enum(['day', 'month', 'year']).default('day'),
})

router.get(
  '/series',
  asyncHandler(async (req, res) => {
    const { from, to, period } = rangeSchema.parse(req.query)
    if (from >= to) throw new HttpError(400, '`from` must be before `to`')

    res.json({
      series: await timeSeries({ tenantId: tenantOf(req), branchIds: readScopeFor(req), from, to, period }),
    })
  }),
)

router.get(
  '/branches',
  asyncHandler(async (req, res) => {
    const { from, to } = rangeSchema.omit({ period: true }).parse(req.query)
    if (from >= to) throw new HttpError(400, '`from` must be before `to`')
    res.json({ branches: await byBranch({ tenantId: tenantOf(req), branchIds: readScopeFor(req), from, to }) })
  }),
)

export default router
