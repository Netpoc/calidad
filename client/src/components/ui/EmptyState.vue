<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

/**
 * An empty state says why it is empty and what to do next — never just
 * "No data".
 */
defineProps<{ icon: IconName; title: string; hint?: string }>()
</script>

<template>
  <div class="flex flex-col items-center px-4 py-10 text-center">
    <div
      class="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-3xl text-slate-400"
      aria-hidden="true"
    >
      <AppIcon :name="icon" />
    </div>
    <p class="m-0 text-sm font-semibold text-slate-700">{{ title }}</p>
    <p v-if="hint" class="m-0 mt-1 max-w-xs text-sm text-slate-500">{{ hint }}</p>
    <div class="mt-4"><slot /></div>
  </div>
</template>
