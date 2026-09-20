import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { Types } from 'mongoose'
import { env } from '../config/env.js'
import { ROLE_RANK, type Role } from '../shared/domain.js'
import { HttpError } from '../shared/http-error.js'

export interface AuthPrincipal {
  userId: string
  role: Role
  /** The business this account belongs to. Null only for platform admins. */
  tenantId: string | null
  /** Empty for owners, whose scope is every branch of their business. */
  branchIds: string[]
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPrincipal
    }
  }
}

export function signToken(principal: AuthPrincipal): string {
  return jwt.sign(principal, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions)
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    next(new HttpError(401, 'Authentication required'))
    return
  }
  try {
    req.auth = jwt.verify(header.slice(7), env.JWT_SECRET) as AuthPrincipal
    next()
  } catch {
    next(new HttpError(401, 'Invalid or expired token'))
  }
}

/** Requires at least the given role (owner > manager > staff > customer). */
export function requireRole(minimum: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new HttpError(401, 'Authentication required'))
      return
    }
    if (ROLE_RANK[req.auth.role] < ROLE_RANK[minimum]) {
      next(new HttpError(403, 'Insufficient permissions'))
      return
    }
    next()
  }
}

/**
 * Branch scoping is an authorization boundary, not a filter (CLAUDE.md).
 * Resolves the branch a request may act on from the *token*, cross-checking any
 * client-supplied branch id rather than trusting it.
 */
export function resolveBranchScope(auth: AuthPrincipal, requestedBranchId?: string): string {
  if (!auth.tenantId) {
    throw new HttpError(403, 'Platform accounts cannot act inside a business')
  }

  if (auth.role === 'owner') {
    if (!requestedBranchId) throw new HttpError(400, 'branchId is required')
    if (!Types.ObjectId.isValid(requestedBranchId)) throw new HttpError(400, 'Invalid branchId')
    return requestedBranchId
  }

  if (auth.branchIds.length === 0) {
    throw new HttpError(403, 'No branch assigned to this account')
  }

  // Managers may hold several branches; without an explicit choice, and only
  // when there is exactly one, we can infer it.
  if (!requestedBranchId) {
    if (auth.branchIds.length === 1) return auth.branchIds[0]!
    throw new HttpError(400, 'branchId is required when assigned to multiple branches')
  }

  if (!auth.branchIds.includes(requestedBranchId)) {
    throw new HttpError(403, 'Branch outside your assigned scope')
  }
  return requestedBranchId
}

/** Every branch this principal may read across — `null` means "all branches". */
export function readableBranchIds(auth: AuthPrincipal): string[] | null {
  return auth.role === 'owner' ? null : auth.branchIds
}
