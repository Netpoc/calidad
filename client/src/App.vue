<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
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
  // Every sync — timer, reconnect, sign-in, or a tap — goes through the
  // connection store, which reports the outcome in one place.
  stopSyncing = startSyncWatcher(
    () => auth.user?.tenantId ?? null,
    () => connection.sync(),
  )
})

// A sign-in is the moment a business's queued bookings can finally go: the
// online event and the 30 s poll would otherwise leave them waiting.
watch(
  () => auth.user?.tenantId ?? null,
  (tenantId) => {
    if (tenantId) void connection.sync()
  },
)

// Tell whoever just signed in that another business's bookings sit on this
// device, rather than letting them wonder why the queue count looks wrong.
watch(
  () => auth.foreignQueued,
  (count) => {
    if (count > 0) {
      toast.warning(
        `${count} booking${count > 1 ? 's' : ''} saved by another business ${count > 1 ? 'are' : 'is'} ` +
          'on this device — they sync when that business signs in.',
      )
    }
  },
)

onUnmounted(() => {
  stopWatching?.()
  stopSyncing?.()
})
</script>

<template>
  <router-view />
  <ToastHost />
</template>
