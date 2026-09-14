<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import type { IconName } from '@/components/ui/icons'

/**
 * A single headline figure. The accent bar and icon tint are what make the
 * dashboard scannable at arm's length — collected is always green, pending
 * always amber, so a manager learns the colours once.
 */
withDefaults(
  defineProps<{
    label: string
    value: string
    icon: IconName
    tone: 'billed' | 'collected' | 'pending' | 'neutral'
    caption?: string
    loading?: boolean
  }>(),
  { loading: false },
)

const TONES = {
  billed: { bar: 'bg-brand-600', chip: 'bg-brand-50 text-brand-700', value: 'text-brand-700' },
  collected: { bar: 'bg-green-600', chip: 'bg-green-50 text-green-700', value: 'text-green-700' },
  pending: { bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700', value: 'text-amber-700' },
  neutral: { bar: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600', value: 'text-slate-700' },
} as const
</script>

<template>
  <div class="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
    <!-- The bar restates the tone for anyone who cannot separate the hues. -->
    <span class="absolute inset-y-0 left-0 w-1.5" :class="TONES[tone].bar" aria-hidden="true" />

    <div class="flex items-start justify-between gap-2 pl-2">
      <div class="min-w-0">
        <p class="m-0 text-xs font-medium uppercase tracking-wide text-slate-500">
          {{ label }}
        </p>
        <p v-if="loading" class="m-0 mt-2 h-7 w-24 animate-pulse rounded bg-slate-100" />
        <p v-else class="m-0 mt-1 text-2xl font-bold" :class="TONES[tone].value">
          {{ value }}
        </p>
        <p v-if="caption" class="m-0 mt-0.5 text-xs text-slate-500">{{ caption }}</p>
      </div>
      <span
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
        :class="TONES[tone].chip"
        aria-hidden="true"
      >
        <AppIcon :name="icon" />
      </span>
    </div>
  </div>
</template>
