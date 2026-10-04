import { describe, expect, it } from 'vitest'
import {
  ROLE_RANK,
  businessPeriodStarts,
  canTransition,
  paymentStageFor,
  paymentStatusFor,
} from './domain.js'

describe('booking lifecycle', () => {
  it('allows the normal counter flow', () => {
    expect(canTransition('received', 'in_progress')).toBe(true)
    expect(canTransition('in_progress', 'ready_for_collection')).toBe(true)
    expect(canTransition('ready_for_collection', 'collected')).toBe(true)
  })

  it('refuses to skip straight to collected', () => {
    // Skipping ready_for_collection would silently swallow the second SMS.
    expect(canTransition('received', 'collected')).toBe(false)
    expect(canTransition('in_progress', 'collected')).toBe(false)
  })

  it('refuses to move backwards', () => {
    expect(canTransition('ready_for_collection', 'in_progress')).toBe(false)
    expect(canTransition('collected', 'received')).toBe(false)
  })

  it('treats collected and cancelled as terminal', () => {
    expect(canTransition('collected', 'cancelled')).toBe(false)
    expect(canTransition('cancelled', 'received')).toBe(false)
  })
})

describe('paymentStatusFor', () => {
  it('distinguishes unpaid, partial, and paid', () => {
    expect(paymentStatusFor(5000, 0)).toBe('unpaid')
    expect(paymentStatusFor(5000, 2000)).toBe('partial')
    expect(paymentStatusFor(5000, 5000)).toBe('paid')
  })

  it('counts an overpayment as paid rather than partial', () => {
    expect(paymentStatusFor(5000, 6000)).toBe('paid')
  })

  it('treats a zero-total booking as paid', () => {
    expect(paymentStatusFor(0, 0)).toBe('paid')
  })
})

describe('role hierarchy', () => {
  it('ranks platform admin above owner above manager above staff', () => {
    expect(ROLE_RANK.platform_admin).toBeGreaterThan(ROLE_RANK.owner)
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.manager)
    expect(ROLE_RANK.manager).toBeGreaterThan(ROLE_RANK.staff)
    expect(ROLE_RANK.staff).toBeGreaterThan(ROLE_RANK.customer)
  })
})

describe('payment stages', () => {
  it('calls a payment that leaves a balance a deposit, and one that clears it the balance', () => {
    expect(paymentStageFor(50000, 20000)).toBe('deposit')
    expect(paymentStageFor(50000, 50000)).toBe('balance')
  })
})

describe('business periods are Lagos time, not server time', () => {
  it('puts 23:30 UTC on the next Lagos day', () => {
    const starts = businessPeriodStarts(new Date('2026-03-31T23:30:00Z')) // 00:30 on 1 April in Lagos
    expect(starts.day.toISOString()).toBe('2026-03-31T23:00:00.000Z')
    expect(starts.month.toISOString()).toBe('2026-03-31T23:00:00.000Z')
    expect(starts.year.toISOString()).toBe('2025-12-31T23:00:00.000Z')
  })

  it('keeps 22:30 UTC on the same Lagos day', () => {
    const starts = businessPeriodStarts(new Date('2026-03-31T22:30:00Z'))
    expect(starts.day.toISOString()).toBe('2026-03-30T23:00:00.000Z')
  })
})
