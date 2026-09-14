import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

/**
 * A price list entry. Both tier prices are optional and stored in kobo; an
 * absent tier means the service is not offered for that item (CLAUDE.md), which
 * is why these are nullable rather than defaulting to 0.
 */
const priceItemSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: 'general' },
    washStarchIronMinor: { type: Number, default: null, min: 0 },
    starchIronMinor: { type: Number, default: null, min: 0 },
    /** Owner-editable price lists may be branch-specific; null means global. */
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
)

priceItemSchema.index({ branchId: 1, name: 1 }, { unique: true })

priceItemSchema.pre('validate', function (next) {
  if (this.washStarchIronMinor == null && this.starchIronMinor == null) {
    next(new Error(`Price item "${this.name}" must offer at least one service tier`))
    return
  }
  next()
})

export type PriceItem = InferSchemaType<typeof priceItemSchema>
export type PriceItemDoc = HydratedDocument<PriceItem>
export const PriceItemModel = model('PriceItem', priceItemSchema)
