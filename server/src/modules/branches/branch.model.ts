import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose'

const branchSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    /** HQ is a branch too, flagged so reports can single it out. */
    isHeadquarters: { type: Boolean, default: false },
    address: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

/** Every business has an "HQ"; names are unique within a business only. */
branchSchema.index({ tenantId: 1, name: 1 }, { unique: true })

export type Branch = InferSchemaType<typeof branchSchema>
export type BranchDoc = HydratedDocument<Branch>
export const BranchModel = model('Branch', branchSchema)
