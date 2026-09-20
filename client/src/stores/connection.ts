import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http } from '@/api/http'
import { ownOutbox } from '@/offline/session'
import { flushOutbox, type SyncResult } from '@/offline/sync'
import { useAuthStore } from './auth'

/**
 * Tracks whether the API is actually reachable, not merely whether the OS
 * claims an interface is up — a phone on a captive-portal wifi reports
 * `navigator.onLine === true` while every request fails.
 */
export const useConnectionStore = defineStore('connection', () => {
  const auth = useAuthStore()
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

  async function probe(): Promise<boolean> {
    if (!navigator.onLine) {
      apiReachable.value = false
      return false
    }
    try {
      await http.get('/health', { timeout: 4000 })
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

  async function sync(): Promise<SyncResult[]> {
    if (!(await probe())) return []
    syncing.value = true
    try {
      const results = await flushOutbox(auth.user?.tenantId ?? null)
      lastSyncAt.value = new Date()
      await refreshQueueCount()
      return results
    } finally {
      syncing.value = false
    }
  }

  function watch(): () => void {
    const onOnline = () => {
      browserOnline.value = true
      void sync()
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
