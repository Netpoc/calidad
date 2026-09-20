import bcrypt from 'bcryptjs'
import { Schema, model, type Model, type HydratedDocument } from 'mongoose'
import { ROLES, type Role } from '../../shared/domain.js'

export interface User {
  /** Null only for platform admins, who belong to no business. */
  tenantId: import('mongoose').Types.ObjectId | null
  name: string
  email: string
  phone: string
  passwordHash: string
  role: Role
  branchIds: import('mongoose').Types.ObjectId[]
  active: boolean
  createdAt: Date
  updatedAt: Date
}

export interface UserMethods {
  verifyPassword(plain: string): Promise<boolean>
}

type UserModelType = Model<User, {}, UserMethods>

const userSchema = new Schema<User, UserModelType, UserMethods>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true, default: '' },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    /**
     * Branch scope for managers and staff. A manager may hold several branches
     * (CLAUDE.md); an owner's scope is implicit and this array stays empty.
     */
    branchIds: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

/** Email stays globally unique: login resolves the user, and so the tenant, from it. */
userSchema.index({ email: 1 }, { unique: true })
userSchema.index({ tenantId: 1, role: 1 })

userSchema.methods.verifyPassword = function (plain: string): Promise<boolean> {
  return bcrypt.compare(plain, this.passwordHash)
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12)
}

export type UserDoc = HydratedDocument<User, UserMethods>
export const UserModel = model<User, UserModelType>('User', userSchema)
