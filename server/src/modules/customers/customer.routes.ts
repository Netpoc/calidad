import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../middleware/async-handler.js'
import { authenticate, requireRole } from '../../middleware/auth.js'
import { requireTenant, tenantOf } from '../../middleware/tenant.js'
import { BookingModel } from '../bookings/booking.model.js'
import { HttpError, param } from '../../shared/http-error.js'
import { CustomerModel } from './customer.model.js'
import { findOrCreateByPhone, searchCustomers } from './customer.service.js'

const router = Router()
router.use(authenticate, requireTenant, requireRole('staff'))

/**
 * The counter lookup: staff type a phone number (in any format) or a name, and
 * a returning customer is matched so their existing id carries over.
 */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    res.json({ customers: await searchCustomers(tenantOf(req), q) })
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

    const bookings = await BookingModel.find({ tenantId, customerId: customer._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('branchId', 'name')

    res.json({ customer, bookings })
  }),
)

export default router
