import { Router, type Request } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../middleware/async-handler.js'
import { authenticate, readableBranchIds, requireRole } from '../../middleware/auth.js'
import { HttpError } from '../../shared/http-error.js'
import { byBranch, headline, timeSeries } from './dashboard.service.js'

const router = Router()
/** Dashboards are for managers and owners (CLAUDE.md). */
router.use(authenticate, requireRole('manager'))

/**
 * Narrows the caller's authorized scope by an optional branchId filter. An
 * owner may look at any branch; a manager may only narrow within their own.
 */
function scopeFor(req: Request): string[] | null {
  const auth = req.auth!
  const requested = typeof req.query.branchId === 'string' ? req.query.branchId : null
  const scope = readableBranchIds(auth)

  if (!requested) return scope
  if (scope !== null && !scope.includes(requested)) {
    throw new HttpError(403, 'Branch outside your assigned scope')
  }
  return [requested]
}

/** Day, month, and year to date — the three headline figures. */
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json({ summary: await headline({ branchIds: scopeFor(req) }) })
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

    res.json({ series: await timeSeries({ branchIds: scopeFor(req), from, to, period }) })
  }),
)

router.get(
  '/branches',
  asyncHandler(async (req, res) => {
    const { from, to } = rangeSchema.omit({ period: true }).parse(req.query)
    res.json({ branches: await byBranch({ branchIds: scopeFor(req), from, to }) })
  }),
)

export default router
