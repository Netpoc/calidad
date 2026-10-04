import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../middleware/async-handler.js'
import { authenticate, readableBranchIds, requireRole } from '../../middleware/auth.js'
import { requireTenant, tenantOf } from '../../middleware/tenant.js'
import { BookingModel } from '../bookings/booking.model.js'
import { HttpError, param } from '../../shared/http-error.js'
import { CustomerModel } from './customer.model.js'
import {
  customerStats,
  findOrCreateByPhone,
  searchCustomers,
  statsFor,
} from './customer.service.js'

const router = Router()
router.use(authenticate, requireTenant, requireRole('staff'))

/**
 * The counter lookup: staff type a phone number (in any format) or a name, and
 * a returning customer is matched so their existing id carries over.
 */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    const { customers, exactPhone } = await searchCustomers(tenantId, q)
    const stats = await customerStats(
      tenantId,
      customers.map((c) => c._id),
      readableBranchIds(req.auth!),
    )
    res.json({
      exactPhone,
      customers: customers.map((c) => ({ ...c.toJSON(), stats: statsFor(stats, c._id) })),
    })
  }),
)

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1),
        phone: z.string().min(6),
        email: z.string().email().optional(),
        address: z.string().optional(),
        homeBranchId: z.string().optional(),
      })
      .parse(req.body)

    const { customer, created } = await findOrCreateByPhone({ ...body, tenantId: tenantOf(req) })
    res.status(created ? 201 : 200).json({ customer, created })
  }),
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const customer = await CustomerModel.findOne({ _id: param(req, 'id'), tenantId })
    if (!customer) throw new HttpError(404, 'Customer not found')

    // The whole history, not a recent page — but only in branches the caller
    // may read, the same boundary as every other booking query.
    const scope = readableBranchIds(req.auth!)
    const filter: Record<string, unknown> = { tenantId, customerId: customer._id }
    if (scope !== null) filter.branchId = { $in: scope }

    const [bookings, stats] = await Promise.all([
      BookingModel.find(filter)
        .sort({ createdAt: -1 })
        .select('-statusHistory -payments')
        .populate('branchId', 'name'),
      customerStats(tenantId, [customer._id], scope),
    ])

    res.json({ customer, bookings, stats: statsFor(stats, customer._id) })
  }),
)

export default router
