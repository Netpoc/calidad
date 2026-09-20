import type { NextFunction, Request, Response } from 'express'
import { Types } from 'mongoose'
import { BranchModel } from '../modules/branches/branch.model.js'
import { TenantModel } from '../modules/tenants/tenant.model.js'
import { HttpError } from '../shared/http-error.js'
import { resolveBranchScope, type AuthPrincipal } from './auth.js'

/** An AuthPrincipal that has passed requireTenant: tenantId is guaranteed. */
export interface TenantPrincipal extends AuthPrincipal {
  tenantId: string
}

/**
 * Tenant scoping is an authorization boundary (CLAUDE.md). Every business
 * route runs `authenticate → requireTenant → requireRole(...)` in that order:
 * requireRole alone would let a rank-4 platform admin straight through.
 *
 * Deactivation must bite before the JWT expires (7 days), so this also checks
 * the tenant's `active` flag — cached for 60 s so it costs one query a minute
 * per business rather than one per request.
 */
const ACTIVE_TTL_MS = 60_000
const activeCache = new Map<string, { active: boolean; at: number }>()

async function tenantIsActive(tenantId: string): Promise<boolean> {
  const cached = activeCache.get(tenantId)
  if (cached && Date.now() - cached.at < ACTIVE_TTL_MS) return cached.active

  const tenant = await TenantModel.findById(tenantId).select('active').lean()
  const active = Boolean(tenant?.active)
  activeCache.set(tenantId, { active, at: Date.now() })
  return active
}

/** Called by the platform PATCH so a deactivation is immediate in-process. */
export function invalidateTenantCache(tenantId: string): void {
  activeCache.delete(tenantId)
}

export async function requireTenant(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    next(new HttpError(401, 'Authentication required'))
    return
  }
  // `!` not `=== null`: a token minted before tenants existed has the field
  // missing (undefined), and must be refused just the same.
  if (!req.auth.tenantId) {
    next(new HttpError(403, 'This account is not attached to a business'))
    return
  }
  if (!(await tenantIsActive(req.auth.tenantId))) {
    next(new HttpError(403, 'This business has been deactivated'))
    return
  }
  next()
}

/** Defensive narrowing for handlers — requireTenant should already have run. */
export function tenantOf(req: Request): string {
  const tenantId = req.auth?.tenantId
  if (!tenantId) throw new HttpError(403, 'This account is not attached to a business')
  return tenantId
}

/**
 * resolveBranchScope only checks that an owner's requested branch id is
 * well-formed. This also proves the branch belongs to the owner's business,
 * so an owner cannot book into another business's branch by guessing an id.
 */
export async function resolveTenantBranch(
  auth: TenantPrincipal,
  requestedBranchId?: string,
): Promise<string> {
  const branchId = resolveBranchScope(auth, requestedBranchId)
  const exists = await BranchModel.exists({ _id: branchId, tenantId: auth.tenantId })
  if (!exists) throw new HttpError(404, 'Branch not found')
  return branchId
}

/**
 * A staff member's token carries their branchIds, and resolveBranchScope
 * trusts them. So the branches assigned at creation must be proven to belong
 * to the business, or an owner could attach staff to a foreign branch.
 */
export async function assertBranchesInTenant(tenantId: string, branchIds: string[]): Promise<void> {
  if (branchIds.length === 0) return
  if (!branchIds.every((id) => Types.ObjectId.isValid(id))) {
    throw new HttpError(400, 'Invalid branch id')
  }
  const count = await BranchModel.countDocuments({ _id: { $in: branchIds }, tenantId })
  if (count !== new Set(branchIds).size) {
    throw new HttpError(400, 'One or more branches do not belong to this business')
  }
}
