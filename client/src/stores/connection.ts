import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http } from '@/api/http'
import { db } from '@/offline/db'
import { flushOutbox, type SyncResult } from '@/offline/sync'

/**
 * Tracks whether the API is actually reachable, not merely whether the OS
 * claims an interface is up — a phone on a captive-portal wifi reports
 * `navigator.onLine === true` while every request fails.
 */
export const useConnectionStore = defineStore('connection', () => {
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

  async function refreshQueueCount(): Promise<void> {
    queuedCount.value = await db.outbox.count()
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

  async function sync(): Promise<SyncResult[]> {
    if (!(await probe())) return []
    syncing.value = true
    try {
      const results = await flushOutbox()
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
    }
    const onOffline = () => {
      browserOnline.value = false
      apiReachable.value = false
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    void refreshQueueCount()
    void probe()

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
    sync,
    watch,
    refreshQueueCount,
  }
})
