import { CustomerModel, type CustomerDoc } from './customer.model.js'
import { normalizePhone } from '../../shared/identity.js'

export interface CustomerInput {
  name: string
  phone: string
  email?: string
  address?: string
  homeBranchId?: string
}

/**
 * The dedup rule from CLAUDE.md: a returning customer keeps their original
 * customerId, and only the booking reference is new. Every booking path must
 * come through here rather than creating customers directly.
 *
 * Concurrency: two tills registering the same walk-in customer at once would
 * both miss on the read, so we lean on the unique phone index and treat a
 * duplicate-key error as "someone else won the race" and re-read.
 */
export async function findOrCreateByPhone(
  input: CustomerInput,
): Promise<{ customer: CustomerDoc; created: boolean }> {
  const phone = normalizePhone(input.phone)

  const existing = await CustomerModel.findOne({ phone })
  if (existing) {
    // Fill in details we did not have before, but never silently rename.
    let touched = false
    if (!existing.email && input.email) {
      existing.email = input.email
      touched = true
    }
    if (!existing.address && input.address) {
      existing.address = input.address
      touched = true
    }
    if (touched) await existing.save()
    return { customer: existing, created: false }
  }

  try {
    const customer = await CustomerModel.create({
      name: input.name,
      phone,
      email: input.email ?? '',
      address: input.address ?? '',
      homeBranchId: input.homeBranchId ?? null,
    })
    return { customer, created: true }
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const raced = await CustomerModel.findOne({ phone })
      if (raced) return { customer: raced, created: false }
    }
    throw error
  }
}

export async function searchCustomers(query: string, limit = 20): Promise<CustomerDoc[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  // A phone-shaped query is the common case at the counter, and it must match
  // regardless of how the staff member typed it.
  if (/\d/.test(trimmed)) {
    try {
      const byPhone = await CustomerModel.findOne({ phone: normalizePhone(trimmed) })
      if (byPhone) return [byPhone]
    } catch {
      // Not a usable phone number; fall through to name search.
    }
  }

  return CustomerModel.find({
    $or: [
      { name: { $regex: escapeRegex(trimmed), $options: 'i' } },
      { customerId: trimmed.toUpperCase() },
    ],
  }).limit(limit)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000
  )
}
