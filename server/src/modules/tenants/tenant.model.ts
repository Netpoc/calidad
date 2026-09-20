import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/**
 * A tenant is one laundry business. Everything a business owns — users,
 * branches, customers, price list, bookings, SMS log — carries its `_id` as
 * `tenantId`, and every query for those collections filters on it.
 *
 * Names are deliberately not unique: two businesses may share a trading name.
 * The owner's email is the identity that must be unique.
 */
const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

tenantSchema.index({ name: 1 })

export type Tenant = InferSchemaType<typeof tenantSchema>
export type TenantDoc = HydratedDocument<Tenant>
export const TenantModel = model('Tenant', tenantSchema)
