import { describe, expect, it } from 'vitest'
import { generateReferenceCode, isValidPhone, normalizePhone } from './identity.js'

describe('normalizePhone', () => {
  it('maps every way a Nigerian number gets typed to one value', () => {
    // This is the customer-dedup key; if these diverge, one customer becomes many.
    const variants = [
      '08031234567',
      '+2348031234567',
      '2348031234567',
      '+234 803 123 4567',
      '0803-123-4567',
      '(0803) 123 4567',
      '8031234567',
    ]
    for (const variant of variants) {
      expect(normalizePhone(variant), variant).toBe('+2348031234567')
    }
  })

  it('keeps non-Nigerian international numbers intact', () => {
    expect(normalizePhone('+447911123456')).toBe('+447911123456')
  })

  it('rejects input with no digits', () => {
    expect(() => normalizePhone('   ')).toThrow()
    expect(isValidPhone('not a phone')).toBe(false)
  })
})

describe('generateReferenceCode', () => {
  it('is 8 characters and within the 6-8 the brief allows', () => {
    const code = generateReferenceCode()
    expect(code).toHaveLength(8)
    expect(code.length).toBeGreaterThanOrEqual(6)
    expect(code.length).toBeLessThanOrEqual(8)
  })

  it('omits characters that are misread or misheard at a counter', () => {
    const codes = Array.from({ length: 500 }, generateReferenceCode).join('')
    expect(codes).not.toMatch(/[01258BILOSZ]/)
  })

  it('does not collide across a realistic run of bookings', () => {
    const codes = new Set(Array.from({ length: 5000 }, generateReferenceCode))
    expect(codes.size).toBe(5000)
  })
})
