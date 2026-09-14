<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useConnectionStore } from '@/stores/connection'
import { startSyncWatcher } from '@/offline/sync'

const auth = useAuthStore()
const connection = useConnectionStore()
const toast = useToast()

let stopWatching: (() => void) | undefined
let stopSyncing: (() => void) | undefined

onMounted(() => {
  auth.restore()
  stopWatching = connection.watch()
  stopSyncing = startSyncWatcher((results) => {
    const created = results.filter((r) => r.status === 'created')
    const failed = results.filter((r) => r.status === 'failed')
    if (created.length) {
      toast.success(
        `${created.length} offline booking${created.length > 1 ? 's' : ''} synced — ` +
          `${created.map((r) => r.referenceCode).join(', ')}`,
      )
    }
    if (failed.length) {
      toast.error(`${failed.length} booking(s) could not sync. Open Bookings to review.`)
    }
    void connection.refreshQueueCount()
  })
})

onUnmounted(() => {
  stopWatching?.()
  stopSyncing?.()
})
</script>

<template>
  <router-view />
  <ToastHost />
</template>
