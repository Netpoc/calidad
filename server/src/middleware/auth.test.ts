import { describe, expect, it } from 'vitest'
import { readableBranchIds, resolveBranchScope, type AuthPrincipal } from './auth.js'

const BRANCH_A = '507f1f77bcf86cd799439011'
const BRANCH_B = '507f1f77bcf86cd799439012'
const BRANCH_C = '507f1f77bcf86cd799439013'

const T = '507f1f77bcf86cd799439099'
const owner: AuthPrincipal = { userId: 'u1', role: 'owner', tenantId: T, branchIds: [] }
const multiManager: AuthPrincipal = {
  userId: 'u2',
  role: 'manager',
  tenantId: T,
  branchIds: [BRANCH_A, BRANCH_B],
}
const soloStaff: AuthPrincipal = { userId: 'u3', role: 'staff', tenantId: T, branchIds: [BRANCH_A] }
const unassigned: AuthPrincipal = { userId: 'u4', role: 'staff', tenantId: T, branchIds: [] }
const platformAdmin: AuthPrincipal = {
  userId: 'u5',
  role: 'platform_admin',
  tenantId: null,
  branchIds: [],
}

describe('resolveBranchScope', () => {
  it('lets an owner act on any branch they name', () => {
    expect(resolveBranchScope(owner, BRANCH_C)).toBe(BRANCH_C)
  })

  it('infers the branch for someone assigned to exactly one', () => {
    expect(resolveBranchScope(soloStaff)).toBe(BRANCH_A)
  })

  it('makes a multi-branch manager choose', () => {
    // A manager may hold several branches, so an unqualified write is ambiguous
    // and must not silently land on the first one.
    expect(() => resolveBranchScope(multiManager)).toThrow(/branchId is required/)
    expect(resolveBranchScope(multiManager, BRANCH_B)).toBe(BRANCH_B)
  })

  it('refuses a branch outside the assigned scope', () => {
    // The security case: a client-supplied branchId must never widen access.
    expect(() => resolveBranchScope(soloStaff, BRANCH_C)).toThrow(/outside your assigned scope/)
    expect(() => resolveBranchScope(multiManager, BRANCH_C)).toThrow(/outside your assigned scope/)
  })

  it('refuses an account with no branch at all', () => {
    expect(() => resolveBranchScope(unassigned, BRANCH_A)).toThrow(/No branch assigned/)
  })

  it('rejects a malformed branch id from an owner', () => {
    expect(() => resolveBranchScope(owner, 'not-an-objectid')).toThrow(/Invalid branchId/)
  })

  it('refuses a platform admin outright, whatever branch they name', () => {
    // Rank 4 would sail past requireRole; the tenant check is the real gate.
    expect(() => resolveBranchScope(platformAdmin, BRANCH_A)).toThrow(/Platform accounts/)
  })
})

describe('readableBranchIds', () => {
  it('returns null for an owner, meaning every branch', () => {
    expect(readableBranchIds(owner)).toBeNull()
  })

  it('returns exactly the assigned branches for everyone else', () => {
    expect(readableBranchIds(multiManager)).toEqual([BRANCH_A, BRANCH_B])
    expect(readableBranchIds(unassigned)).toEqual([])
  })
})
