import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

const branchSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /** HQ is a branch too, flagged so reports can single it out. */
    isHeadquarters: { type: Boolean, default: false },
    address: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

branchSchema.index({ name: 1 }, { unique: true })

export type Branch = InferSchemaType<typeof branchSchema>
export type BranchDoc = HydratedDocument<Branch>
export const BranchModel = model('Branch', branchSchema)
