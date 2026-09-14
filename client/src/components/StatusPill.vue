<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import type { StatusMeta } from '@/api/display'

/**
 * Colour + icon + word, always together. In greyscale or for a colour-blind
 * user the label still carries the meaning; the colour just makes it faster to
 * scan a list of twenty bookings.
 */
defineProps<{ meta: StatusMeta; size?: 'sm' | 'md' }>()
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full border font-medium leading-none"
    :class="[meta.classes, size === 'sm' ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm']"
  >
    <AppIcon :name="meta.icon" />
    {{ meta.label }}
  </span>
</template>
