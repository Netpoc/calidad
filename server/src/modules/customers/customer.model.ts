import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'
import { generateCustomerId, normalizePhone } from '../../shared/identity.js'

const customerSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    /** Stable, customer-facing id reused across every future booking. */
    customerId: { type: String, required: true, default: generateCustomerId },
    name: { type: String, required: true, trim: true },
    /**
     * Stored normalized (E.164). This is the dedup key — see
     * findOrCreateByPhone in customer.service.ts. Never write a raw phone here.
     */
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    address: { type: String, trim: true, default: '' },
    /** Branch that first registered the customer; they may use any branch. */
    homeBranchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
)

/**
 * Phone dedup is per business: the same person is a separate customer at each
 * laundry they use, and one business never learns about another's customers.
 */
customerSchema.index({ tenantId: 1, phone: 1 }, { unique: true })
customerSchema.index({ customerId: 1 }, { unique: true })
customerSchema.index({ tenantId: 1, name: 1 })
customerSchema.index({ name: 'text' })

/** Belt and braces: normalize on save even if a caller forgot to. */
customerSchema.pre('save', function (next) {
  if (this.isModified('phone') && this.phone) {
    this.phone = normalizePhone(this.phone)
  }
  next()
})

export type Customer = InferSchemaType<typeof customerSchema>
export type CustomerDoc = HydratedDocument<Customer>
export const CustomerModel = model('Customer', customerSchema)
