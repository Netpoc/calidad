/**
 * A v4 UUID for idempotency keys (`clientRequestId`, payment `requestId`).
 *
 * `crypto.randomUUID` exists only in secure contexts — HTTPS or localhost —
 * and only from Chrome 92 / Safari 15.4. On a phone opening the app over
 * plain HTTP on the shop's wifi, or an older handset, it is undefined, and
 * calling it threw before an offline booking could be saved. So it is used
 * when present, and otherwise built from `crypto.getRandomValues`, which
 * every browser offers in every context. Same format, same randomness.
 */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
