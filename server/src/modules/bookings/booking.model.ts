import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'
import {
  BOOKING_STATUSES,
  PAYMENT_STATUSES,
  SERVICE_TIERS,
  paymentStatusFor,
} from '../../shared/domain.js'
import { generateReferenceCode } from '../../shared/identity.js'

/**
 * One garment line. Laundry is registered "each-by-each" (CLAUDE.md), so the
 * unit price is snapshotted here — later price-list edits by the owner must not
 * retroactively change what an existing booking was billed.
 */
const bookingItemSchema = new Schema(
  {
    priceItemId: { type: Schema.Types.ObjectId, ref: 'PriceItem', required: true },
    name: { type: String, required: true },
    tier: { type: String, enum: SERVICE_TIERS, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceMinor: { type: Number, required: true, min: 0 },
    lineTotalMinor: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const statusEventSchema = new Schema(
  {
    status: { type: String, enum: BOOKING_STATUSES, required: true },
    at: { type: Date, required: true, default: () => new Date() },
    byUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
)

const bookingSchema = new Schema(
  {
    referenceCode: { type: String, required: true, default: generateReferenceCode },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    items: { type: [bookingItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },

    subtotalMinor: { type: Number, required: true, min: 0 },
    discountMinor: { type: Number, default: 0, min: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
    paidMinor: { type: Number, default: 0, min: 0 },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'unpaid', index: true },

    status: { type: String, enum: BOOKING_STATUSES, default: 'received', index: true },
    statusHistory: { type: [statusEventSchema], default: [] },

    expectedReadyAt: { type: Date },
    collectedAt: { type: Date },

    /**
     * Idempotency key supplied by the client. Offline bookings are replayed on
     * reconnect, and without this a flaky connection produces duplicate
     * bookings and duplicate SMS. Unique among documents that define it.
     */
    clientRequestId: { type: String, default: null },
    /** True when the booking reached the server via the offline sync endpoint. */
    syncedFromOffline: { type: Boolean, default: false },
  },
  { timestamps: true },
)

bookingSchema.index({ referenceCode: 1 }, { unique: true })
bookingSchema.index(
  { clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } },
)
/** Dashboard aggregations scan by branch and date. */
bookingSchema.index({ branchId: 1, createdAt: -1 })
bookingSchema.index({ branchId: 1, status: 1, createdAt: -1 })

bookingSchema.pre('validate', function (next) {
  const subtotal = this.items.reduce((sum, item) => sum + item.lineTotalMinor, 0)
  this.subtotalMinor = subtotal
  this.totalMinor = Math.max(0, subtotal - (this.discountMinor ?? 0))
  this.paymentStatus = paymentStatusFor(this.totalMinor, this.paidMinor ?? 0)
  next()
})

export type Booking = InferSchemaType<typeof bookingSchema>
export type BookingDoc = HydratedDocument<Booking>
export const BookingModel = model('Booking', bookingSchema)
