import { db, getMeta, setMeta } from './db'

const SESSION_TENANT_KEY = 'session.tenantId'
export const PRICING_TENANT_KEY = 'pricing.tenantId'

/** Service-worker runtime caches that hold business data (see vite.config.ts). */
const TENANT_SW_CACHES = ['pricing', 'reference-data']

/**
 * Everything cached for the current business, but NOT the outbox.
 *
 * The service worker caches /api/pricing by URL alone — the Authorization
 * header is not part of the cache key — so without this a phone used by two
 * businesses would serve the first one's price list to the second.
 */
export async function clearTenantCaches(): Promise<void> {
  await db.priceItems.clear()
  await db.meta.bulkDelete(['pricing.fetchedAt', PRICING_TENANT_KEY])

  if (typeof caches === 'undefined') return
  for (const key of await caches.keys()) {
    if (TENANT_SW_CACHES.some((name) => key.includes(name))) await caches.delete(key)
  }
}

/**
 * Called on login before the new user is visible. Clears caches when the
 * business changes and reports how many queued bookings on this device belong
 * to some other business, so the UI can say so rather than silently sitting
 * on them.
 */
export async function switchSession(nextTenantId: string | null): Promise<number> {
  const previous = (await getMeta<string | null>(SESSION_TENANT_KEY)) ?? null
  if (previous !== nextTenantId) await clearTenantCaches()
  await setMeta(SESSION_TENANT_KEY, nextTenantId)
  return foreignOutboxCount(nextTenantId)
}

/** Outbox entries for this business only. */
export function ownOutbox(tenantId: string | null) {
  if (!tenantId) return db.outbox.where('tenantId').equals('__none__')
  return db.outbox.where('tenantId').equals(tenantId)
}

export async function foreignOutboxCount(tenantId: string | null): Promise<number> {
  const all = await db.outbox.count()
  const own = tenantId ? await ownOutbox(tenantId).count() : 0
  return all - own
}
