<script setup lang="ts">
import { computed } from 'vue'
import { PATHS, type IconName } from './icons'

/**
 * Icons are decorative by default — `aria-hidden` unless a label is passed,
 * because the adjacent text already carries the meaning.
 */
const props = defineProps<{ name: IconName; label?: string }>()

const path = computed(() => PATHS[props.name])
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="h-[1em] w-[1em] shrink-0"
    :aria-hidden="label ? undefined : 'true'"
    :role="label ? 'img' : undefined"
    :aria-label="label"
  >
    <path :d="path" />
  </svg>
</template>
