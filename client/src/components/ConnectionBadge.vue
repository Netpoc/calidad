<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { IconName } from '@/components/ui/icons'
import { useConnectionStore } from '@/stores/connection'

const connection = useConnectionStore()

/**
 * Staff need to know at a glance whether a booking just reached the server or
 * only this device, so the queue depth is in the label rather than hidden. Icon
 * plus word, never colour alone.
 */
const state = computed<{ label: string; icon: IconName; classes: string }>(() => {
  if (connection.syncing) {
    return { label: 'Syncing', icon: 'refresh', classes: 'bg-white/20 text-white' }
  }
  if (!connection.isOnline) {
    return {
      label: connection.queuedCount > 0 ? `Offline · ${connection.queuedCount}` : 'Offline',
      icon: 'cloud',
      classes: 'bg-amber-400 text-amber-950',
    }
  }
  if (connection.queuedCount > 0) {
    return {
      label: `${connection.queuedCount} to sync`,
      icon: 'cloud-upload',
      classes: 'bg-white/20 text-white',
    }
  }
  return { label: 'Online', icon: 'check-circle', classes: 'bg-white/20 text-white' }
})
</script>

<template>
  <button
    type="button"
    class="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full border-0 px-3 text-xs font-semibold"
    :class="state.classes"
    :aria-label="`Connection: ${state.label}. Tap to sync now.`"
    @click="connection.sync()"
  >
    <AppIcon :name="state.icon" :class="connection.syncing && 'animate-spin'" />
    {{ state.label }}
  </button>
</template>
