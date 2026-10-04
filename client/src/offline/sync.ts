import { errorMessage, http } from '@/api/http'
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

/**
 * What a flush did. `results` is empty unless the server answered; `state`
 * says why, so a tap on "Sync now" never looks like a dead button.
 */
export interface SyncOutcome {
  state: 'synced' | 'nothing' | 'busy' | 'offline' | 'unreachable'
  results: SyncResult[]
  /** Set when `state` is `unreachable`. */
  error?: string
}

/** Automatic retries before a rejected booking waits for a person to tap "Sync now". */
export const AUTO_RETRY_LIMIT = 3

/**
 * Long enough for Render's free tier to wake (20–50 s) and then create a batch
 * of bookings. The 15 s default made the first sync after a quiet spell time
 * out on the wake-up alone.
 */
const SYNC_TIMEOUT_MS = 90_000

let running = false

/**
 * Drains the outbox to the server.
 *
 * Entries keep their clientRequestId across retries, so the server recognises a
 * replay and returns the original booking instead of creating a second one —
 * which is also what prevents a duplicate "your laundry is booked" SMS. That
 * guarantee is what makes every retry below safe.
 *
 * A `failed` entry is one the server rejected on its merits (an unknown price
 * item, a tier that is not offered). Background flushes give up on it after
 * AUTO_RETRY_LIMIT tries; a manual flush always tries again, because the person
 * tapping "Sync now" may have just fixed the cause (re-added the price, say).
 */
export async function flushOutbox(
  tenantId: string | null,
  { manual = false }: { manual?: boolean } = {},
): Promise<SyncOutcome> {
  // Only this business's entries. A booking queued under another business
  // waits on this device until that business signs in again — sending it now
  // would file it under the wrong business.
  if (!tenantId) return { state: 'nothing', results: [] }
  if (running) return { state: 'busy', results: [] }
  if (!navigator.onLine) return { state: 'offline', results: [] }
  running = true

  try {
    // `syncing` is included on purpose: an entry is left in that state when
    // the app is closed or the phone sleeps mid-request, and nothing else
    // would ever reset it. `running` means no flush in this tab owns it now.
    const pending = await ownOutbox(tenantId).toArray()
    const batch = pending.filter(
      (entry) => entry.status !== 'failed' || manual || entry.attempts < AUTO_RETRY_LIMIT,
    )
    if (batch.length === 0) return { state: 'nothing', results: [] }

    await db.outbox.bulkPut(batch.map((entry) => ({ ...entry, status: 'syncing' as const })))

    let data: { results: SyncResult[] }
    try {
      ;({ data } = await http.post<{ results: SyncResult[] }>(
        '/bookings/sync',
        { bookings: batch.map(toPayload) },
        { timeout: SYNC_TIMEOUT_MS },
      ))
    } catch (error) {
      // Never reached the server, or the request as a whole was refused.
      // Restore each entry as it was — a `failed` one stays failed, with its
      // attempt count — so nothing is lost and the next try picks them up.
      // A partial server-side success is safe to replay (idempotency key).
      const message = errorMessage(error)
      await db.outbox.bulkPut(
        batch.map((entry) => ({
          ...entry,
          status: entry.status === 'failed' ? ('failed' as const) : ('queued' as const),
          lastError: message,
        })),
      )
      return { state: 'unreachable', results: [], error: message }
    }

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

    return { state: 'synced', results: data.results }
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
    paymentMethod: entry.paymentMethod,
    takenAt: entry.takenAt ?? new Date(entry.createdAt).toISOString(),
  }
}

/**
 * Flush when the browser regains connectivity, and on a timer while there is
 * work queued. The tenant is read at each run, not captured, because the
 * signed-in business can change without a page reload.
 */
export function startSyncWatcher(
  currentTenant: () => string | null,
  flush: () => Promise<unknown>,
): () => void {
  window.addEventListener('online', flush)
  // The `online` event is optimistic — it fires when the OS sees an interface,
  // not when the API is reachable — so also poll while there is work queued.
  const timer = window.setInterval(async () => {
    const tenantId = currentTenant()
    if (navigator.onLine && tenantId && (await ownOutbox(tenantId).count()) > 0) await flush()
  }, 30_000)

  void flush()

  return () => {
    window.removeEventListener('online', flush)
    window.clearInterval(timer)
  }
}
