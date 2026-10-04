import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http } from '@/api/http'
import { ownOutbox } from '@/offline/session'
import { flushOutbox, type SyncOutcome } from '@/offline/sync'
import { useToast } from '@/composables/useToast'
import { plural } from '@/composables/useMoney'
import { useAuthStore } from './auth'

/**
 * Tracks whether the API is actually reachable, not merely whether the OS
 * claims an interface is up — a phone on a captive-portal wifi reports
 * `navigator.onLine === true` while every request fails.
 */
export const useConnectionStore = defineStore('connection', () => {
  const auth = useAuthStore()
  const toast = useToast()
  const browserOnline = ref(navigator.onLine)
  const apiReachable = ref(navigator.onLine)
  const queuedCount = ref(0)
  const syncing = ref(false)
  const lastSyncAt = ref<Date | null>(null)

  const isOnline = computed(() => browserOnline.value && apiReachable.value)
  const status = computed<'online' | 'offline' | 'syncing'>(() => {
    if (syncing.value) return 'syncing'
    return isOnline.value ? 'online' : 'offline'
  })

  /** Only this business's queue — another business's work is not "to sync" here. */
  async function refreshQueueCount(): Promise<void> {
    queuedCount.value = await ownOutbox(auth.user?.tenantId ?? null).count()
  }

  async function probe(timeout = 4000): Promise<boolean> {
    if (!navigator.onLine) {
      apiReachable.value = false
      return false
    }
    try {
      await http.get('/health', { timeout })
      apiReachable.value = true
    } catch {
      apiReachable.value = false
    }
    return apiReachable.value
  }

  /**
   * The API on Render's free tier sleeps after idle and takes 20–50 s to wake,
   * far longer than the 4 s probe. Without this, staff opening the app in the
   * morning see "Offline" on a phone with full signal and the first bookings
   * go to the outbox. So on startup one long-patience request is fired in the
   * background; when the server answers, the badge flips to Online and the
   * outbox drains. The short probe stays short, because a real dead connection
   * must still be detected quickly.
   */
  let warming = false
  async function warmUp(): Promise<void> {
    if (warming || apiReachable.value || !navigator.onLine) return
    warming = true
    try {
      await http.get('/health', { timeout: 60_000 })
      apiReachable.value = true
      void sync()
    } catch {
      // Still unreachable after a minute — the periodic probe takes over.
    } finally {
      warming = false
    }
  }

  /**
   * Sends this business's queued bookings and says what happened.
   *
   * A tap on "Sync now" (`manual`) is patient: it waits up to a minute for a
   * sleeping server rather than giving up after the 4 s probe — which is what
   * made the button look dead right after reconnecting — and it retries
   * bookings the background sync has given up on. Background runs stay quick
   * and quiet unless something actually synced or failed.
   */
  async function sync({ manual = false }: { manual?: boolean } = {}): Promise<SyncOutcome> {
    if (syncing.value) {
      if (manual) toast.info('Already syncing…')
      return { state: 'busy', results: [] }
    }
    syncing.value = true
    try {
      let outcome: SyncOutcome
      if (!navigator.onLine) {
        outcome = { state: 'offline', results: [] }
      } else if (!(await probe(manual ? 60_000 : 4000))) {
        outcome = { state: 'unreachable', results: [], error: 'Server not responding' }
      } else {
        outcome = await flushOutbox(auth.user?.tenantId ?? null, { manual })
      }

      if (outcome.state === 'synced') {
        apiReachable.value = true
        lastSyncAt.value = new Date()
      } else if (outcome.state === 'unreachable') {
        apiReachable.value = false
      }
      await refreshQueueCount()
      report(outcome, manual)
      return outcome
    } finally {
      syncing.value = false
    }
  }

  function report(outcome: SyncOutcome, manual: boolean): void {
    const sent = outcome.results.filter((r) => r.status !== 'failed')
    const failed = outcome.results.filter((r) => r.status === 'failed')
    if (sent.length) {
      toast.success(
        `${plural(sent.length, 'offline booking')} synced — ` +
          sent.map((r) => r.referenceCode).join(', '),
        6000,
      )
    }
    if (failed.length) {
      toast.error(
        `${plural(failed.length, 'booking')} could not sync: ${failed[0]!.error ?? 'rejected'}. ` +
          'Open Bookings to review.',
        8000,
      )
    }
    if (!manual) return
    if (outcome.state === 'nothing') toast.info('Nothing waiting to sync')
    if (outcome.state === 'busy') toast.info('Already syncing…')
    if (outcome.state === 'offline') {
      toast.warning('No internet on this device — bookings stay saved here')
    }
    if (outcome.state === 'unreachable') {
      toast.warning(
        `Could not reach the server (${outcome.error}). Bookings stay saved here — try again shortly.`,
        8000,
      )
    }
  }

  function watch(): () => void {
    // Syncing on `online` is startSyncWatcher's job (App.vue); doing it here
    // too raced it and reported "busy".
    const onOnline = () => {
      browserOnline.value = true
      void warmUp()
    }
    const onOffline = () => {
      browserOnline.value = false
      apiReachable.value = false
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    void refreshQueueCount()
    // Quick probe for an honest first badge, then the patient wake-up call.
    void probe().then((ok) => {
      if (!ok) void warmUp()
    })

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }

  return {
    browserOnline,
    apiReachable,
    isOnline,
    status,
    queuedCount,
    syncing,
    lastSyncAt,
    probe,
    warmUp,
    sync,
    watch,
    refreshQueueCount,
  }
})
