import { afterEach, describe, expect, it, vi } from 'vitest'
import { uuid } from './uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => vi.unstubAllGlobals())

describe('uuid', () => {
  it('works where crypto.randomUUID is missing (plain HTTP, older phones)', () => {
    // What an insecure context exposes: getRandomValues, no randomUUID.
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })

    const ids = new Set(Array.from({ length: 1000 }, () => uuid()))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id).toMatch(V4)
  })

  it('uses crypto.randomUUID when the browser has it', () => {
    expect(uuid()).toMatch(V4)
  })
})
