import { Router } from 'express'
import { z } from 'zod'
import { authenticate, readableBranchIds, resolveBranchScope, requireRole } from '../../middleware/auth.js'
import { asyncHandler } from '../../middleware/async-handler.js'
import { BOOKING_STATUSES, SERVICE_TIERS } from '../../shared/domain.js'
import { HttpError, param } from '../../shared/http-error.js'
import { BookingModel } from './booking.model.js'
import { createBooking, recordPayment, updateBookingStatus } from './booking.service.js'

const router = Router()
router.use(authenticate, requireRole('staff'))

const createSchema = z.object({
  branchId: z.string().optional(),
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().min(6),
    email: z.string().email().optional(),
    address: z.string().optional(),
  }),
  items: z
    .array(
      z.object({
        priceItemId: z.string(),
        tier: z.enum(SERVICE_TIERS),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1),
  discountMinor: z.number().int().min(0).optional(),
  paidMinor: z.number().int().min(0).optional(),
  expectedReadyAt: z.coerce.date().optional(),
  clientRequestId: z.string().min(8).optional(),
})

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body)
    const branchId = resolveBranchScope(req.auth!, body.branchId)

    const { booking, customerCreated, replayed } = await createBooking({
      ...body,
      branchId,
      createdByUserId: req.auth!.userId,
    })

    res.status(replayed ? 200 : 201).json({ booking, customerCreated, replayed })
  }),
)

/**
 * Offline sync. The client replays its queue here; each entry carries the
 * clientRequestId it was created with, so replaying a batch that partially
 * succeeded is safe. Entries are processed independently — one bad booking
 * must not block the rest of the queue from draining.
 */
const syncSchema = z.object({
  bookings: z.array(createSchema.extend({ clientRequestId: z.string().min(8) })).max(100),
})

router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const { bookings } = syncSchema.parse(req.body)

    const results = await Promise.all(
      bookings.map(async (entry) => {
        try {
          const branchId = resolveBranchScope(req.auth!, entry.branchId)
          const { booking, replayed } = await createBooking({
            ...entry,
            branchId,
            createdByUserId: req.auth!.userId,
            syncedFromOffline: true,
          })
          return {
            clientRequestId: entry.clientRequestId,
            status: replayed ? ('duplicate' as const) : ('created' as const),
            referenceCode: booking.referenceCode,
            bookingId: booking._id.toString(),
            totalMinor: booking.totalMinor,
          }
        } catch (error) {
          return {
            clientRequestId: entry.clientRequestId,
            status: 'failed' as const,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }),
    )

    res.json({ results })
  }),
)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = readableBranchIds(req.auth!)
    const filter: Record<string, unknown> = {}
    if (scope !== null) filter.branchId = { $in: scope }

    const status = req.query.status
    if (typeof status === 'string' && BOOKING_STATUSES.includes(status as never)) {
      filter.status = status
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const bookings = await BookingModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('customerId', 'name phone customerId')
      .populate('branchId', 'name')

    res.json({ bookings })
  }),
)

/** Lookup by the code the customer quotes at the counter. */
router.get(
  '/reference/:code',
  asyncHandler(async (req, res) => {
    const booking = await BookingModel.findOne({
      referenceCode: param(req, 'code').toUpperCase(),
    })
      .populate('customerId', 'name phone customerId')
      .populate('branchId', 'name')
    if (!booking) throw new HttpError(404, 'No booking with that reference')

    const scope = readableBranchIds(req.auth!)
    const bookingBranchId = (booking.branchId as { _id: { toString(): string } })._id.toString()
    if (scope !== null && !scope.includes(bookingBranchId)) {
      throw new HttpError(403, 'Booking outside your assigned scope')
    }

    res.json({ booking })
  }),
)

router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(BOOKING_STATUSES) }).parse(req.body)
    const bookingId = param(req, 'id')
    await assertBookingInScope(bookingId, req.auth!)

    const booking = await updateBookingStatus({
      bookingId,
      status,
      byUserId: req.auth!.userId,
    })
    res.json({ booking })
  }),
)

router.post(
  '/:id/payments',
  asyncHandler(async (req, res) => {
    const { amountMinor } = z.object({ amountMinor: z.number().int().min(1) }).parse(req.body)
    const bookingId = param(req, 'id')
    await assertBookingInScope(bookingId, req.auth!)

    const booking = await recordPayment({ bookingId, amountMinor })
    res.json({ booking })
  }),
)

async function assertBookingInScope(
  bookingId: string,
  auth: NonNullable<Express.Request['auth']>,
): Promise<void> {
  const scope = readableBranchIds(auth)
  if (scope === null) return

  const booking = await BookingModel.findById(bookingId).select('branchId')
  if (!booking) throw new HttpError(404, 'Booking not found')
  if (!scope.includes(booking.branchId.toString())) {
    throw new HttpError(403, 'Booking outside your assigned scope')
  }
}

export default router
