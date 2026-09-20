import { http } from '@/api/http'
import { db, type QueuedBooking } from './db'
import { ownOutbox } from './session'

export interface SyncResult {
  clientRequestId: string
  status: 'created' | 'duplicate' | 'failed'
  referenceCode?: string
  bookingId?: string
  totalMinor?: number
  error?: string
}

let running = false

/**
 * Drains the outbox to the server.
 *
 * Entries keep their clientRequestId across retries, so the server recognises a
 * replay and returns the original booking instead of creating a second one —
 * which is also what prevents a duplicate "your laundry is ready" SMS.
 *
 * A `failed` entry is one the server rejected on its merits (an unknown price
 * item, a tier that is not offered); retrying it unchanged will never succeed,
 * so it is kept for a human to resolve rather than retried forever.
 */
export async function flushOutbox(tenantId: string | null): Promise<SyncResult[]> {
  // Only this business's entries. A booking queued under another business
  // waits on this device until that business signs in again — sending it now
  // would file it under the wrong business.
  if (running || !navigator.onLine || !tenantId) return []
  running = true

  try {
    const pending = await ownOutbox(tenantId)
      .and((entry) => entry.status === 'queued' || entry.status === 'failed')
      .toArray()
    if (pending.length === 0) return []

    // Only retry `failed` entries that have not exhausted their attempts.
    const batch = pending.filter((entry) => entry.status === 'queued' || entry.attempts < 3)
    if (batch.length === 0) return []

    await db.outbox.bulkPut(batch.map((entry) => ({ ...entry, status: 'syncing' as const })))

    const { data } = await http.post<{ results: SyncResult[] }>('/bookings/sync', {
      bookings: batch.map(toPayload),
    })

    for (const result of data.results) {
      if (result.status === 'created' || result.status === 'duplicate') {
        await db.outbox.delete(result.clientRequestId)
      } else {
        const entry = batch.find((b) => b.clientRequestId === result.clientRequestId)
        await db.outbox.update(result.clientRequestId, {
          status: 'failed',
          attempts: (entry?.attempts ?? 0) + 1,
          lastError: result.error,
        })
      }
    }

    return data.results
  } catch (error) {
    // Network failure mid-flush: put everything back so the next attempt picks
    // it up. Nothing is lost, and the idempotency key makes a partial server
    // -side success safe to replay.
    const stuck = await db.outbox.where('status').equals('syncing').toArray()
    await db.outbox.bulkPut(
      stuck.map((entry) => ({
        ...entry,
        status: 'queued' as const,
        lastError: error instanceof Error ? error.message : 'Network error',
      })),
    )
    return []
  } finally {
    running = false
  }
}

function toPayload(entry: QueuedBooking) {
  return {
    clientRequestId: entry.clientRequestId,
    branchId: entry.branchId,
    customer: entry.customer,
    items: entry.items,
    discountMinor: entry.discountMinor,
    paidMinor: entry.paidMinor,
  }
}

/**
 * Flush when the browser regains connectivity, and once on startup. The
 * tenant is read at each run, not captured, because the signed-in business
 * can change without a page reload.
 */
export function startSyncWatcher(
  currentTenant: () => string | null,
  onFlush?: (results: SyncResult[]) => void,
): () => void {
  const run = async () => {
    const results = await flushOutbox(currentTenant())
    if (results.length && onFlush) onFlush(results)
  }

  window.addEventListener('online', run)
  // The `online` event is optimistic — it fires when the OS sees an interface,
  // not when the API is reachable — so also poll while there is work queued.
  const timer = window.setInterval(async () => {
    const tenantId = currentTenant()
    if (navigator.onLine && tenantId && (await ownOutbox(tenantId).count()) > 0) await run()
  }, 30_000)

  void run()

  return () => {
    window.removeEventListener('online', run)
    window.clearInterval(timer)
  }
}
