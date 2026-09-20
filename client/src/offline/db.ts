import Dexie, { type Table } from 'dexie'
import type { PriceItem } from '@/api/types'

/** A booking captured on the device, waiting to reach the server. */
export interface QueuedBooking {
  /** Idempotency key. Generated once, reused on every retry — this is what
   *  stops a flaky connection from creating duplicate bookings and SMS. */
  clientRequestId: string
  /**
   * The business this booking was taken for. Sync sends only the current
   * business's entries: a booking queued under business A must never be
   * replayed with business B's token, which would file it under B.
   */
  tenantId: string
  branchId: string
  customer: { name: string; phone: string; email?: string; address?: string }
  items: Array<{ priceItemId: string; tier: string; quantity: number }>
  discountMinor?: number
  paidMinor?: number
  /** Computed on-device for the receipt; the server total is authoritative. */
  provisionalTotalMinor: number
  /** Shown on the ticket until the server issues the real reference code. */
  provisionalReference: string
  createdAt: number
  attempts: number
  lastError?: string
  status: 'queued' | 'syncing' | 'failed'
}

/** Cached so staff can price a booking with no connection. */
export interface CachedPriceItem extends PriceItem {
  cachedAt: number
}

class CalidadDb extends Dexie {
  outbox!: Table<QueuedBooking, string>
  priceItems!: Table<CachedPriceItem, string>
  meta!: Table<{ key: string; value: unknown }, string>

  constructor() {
    super('calidad')
    this.version(1).stores({
      outbox: 'clientRequestId, status, createdAt',
      priceItems: '_id, name',
      meta: 'key',
    })
    // v2: outbox entries carry and are indexed by tenantId. Entries from
    // before have no business and stay quarantined — never sent, never lost.
    this.version(2)
      .stores({
        outbox: 'clientRequestId, status, createdAt, tenantId',
        priceItems: '_id, name',
        meta: 'key',
      })
      .upgrade((tx) =>
        tx
          .table('outbox')
          .toCollection()
          .modify((entry: Partial<QueuedBooking>) => {
            entry.tenantId ??= ''
          }),
      )
  }
}

export const db = new CalidadDb()

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key)
  return row?.value as T | undefined
}
