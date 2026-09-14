<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

withDefaults(
  defineProps<{ tone: 'info' | 'warning' | 'error' | 'success'; title?: string; icon?: IconName }>(),
  {},
)

const TONES = {
  info: 'bg-blue-50 border-blue-200 text-blue-900',
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
  error: 'bg-red-50 border-red-200 text-red-900',
  success: 'bg-green-50 border-green-200 text-green-900',
} as const

const DEFAULT_ICONS = {
  info: 'inbox',
  warning: 'warning',
  error: 'x-circle',
  success: 'check-circle',
} as const
</script>

<template>
  <div class="flex items-start gap-2.5 rounded-xl border p-3" :class="TONES[tone]" role="status">
    <AppIcon :name="icon ?? DEFAULT_ICONS[tone]" class="mt-0.5 text-lg" />
    <div class="min-w-0 text-sm">
      <p v-if="title" class="m-0 font-semibold">{{ title }}</p>
      <div :class="title && 'opacity-90'"><slot /></div>
    </div>
  </div>
</template>
