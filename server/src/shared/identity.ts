import { customAlphabet } from 'nanoid'

/**
 * Reference codes are read aloud over a counter and copied off paper tickets,
 * so the alphabet excludes characters that are confused by eye or ear:
 * 0/O, 1/I/L, 2/Z, 5/S, 8/B.
 */
const REFERENCE_ALPHABET = '34679ACDEFGHJKMNPQRTUVWXY'
const REFERENCE_LENGTH = 8

const generate = customAlphabet(REFERENCE_ALPHABET, REFERENCE_LENGTH)

/** A booking reference. Uniqueness is enforced by a unique index, not by hope. */
export function generateReferenceCode(): string {
  return generate()
}

/** Customer-facing short id, distinct from the Mongo _id. */
const generateCustomerCode = customAlphabet(REFERENCE_ALPHABET, 6)

export function generateCustomerId(): string {
  return `C${generateCustomerCode()}`
}

const NG_COUNTRY_CODE = '234'

/**
 * Customer identity is deduplicated by phone number (CLAUDE.md), so every code
 * path that touches a phone number must normalize it the same way first —
 * otherwise "08031234567" and "+2348031234567" become two customers.
 *
 * Nigerian numbers are assumed when no country code is present.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (!digits) {
    throw new Error('Phone number contains no digits')
  }

  // Already international: +234..., or a bare country code we recognise.
  if (hasPlus) return `+${digits}`
  if (digits.startsWith(NG_COUNTRY_CODE) && digits.length >= 13) return `+${digits}`

  // Local Nigerian format: 0803... -> +234803...
  if (digits.startsWith('0')) return `+${NG_COUNTRY_CODE}${digits.slice(1)}`

  // Bare subscriber number: 803... -> +234803...
  if (digits.length === 10) return `+${NG_COUNTRY_CODE}${digits}`

  return `+${digits}`
}

export function isValidPhone(input: string): boolean {
  try {
    const normalized = normalizePhone(input)
    return /^\+\d{10,15}$/.test(normalized)
  } catch {
    return false
  }
}
