import { describe, expect, it } from 'vitest'
import { formatNaira, toMinor } from './useMoney'

describe('money conversion', () => {
  it('round-trips naira through minor units without drift', () => {
    // Prices come off the CSV as decimals; storing them as floats would put
    // 0.1 + 0.2 problems onto a customer's bill.
    for (const naira of [500, 1500.5, 0.01, 2500.99, 6000]) {
      expect(toMinor(naira) / 100).toBeCloseTo(naira, 2)
    }
  })

  it('converts to integer kobo', () => {
    expect(toMinor(700)).toBe(70000)
    expect(toMinor(1500.5)).toBe(150050)
    expect(Number.isInteger(toMinor(0.005))).toBe(true)
  })

  it('formats whole naira without trailing decimals', () => {
    expect(formatNaira(70000)).toBe('₦700')
    expect(formatNaira(0)).toBe('₦0')
  })

  it('shows kobo only when there are any', () => {
    expect(formatNaira(150050)).toBe('₦1,500.5')
  })
})
