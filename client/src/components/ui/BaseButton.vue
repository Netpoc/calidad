<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

/**
 * Every variant is at least 44px tall — these are pressed with a thumb at a
 * counter. `loading` disables the button as well as showing the spinner, so a
 * double-tap cannot submit a booking twice.
 */
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    type?: 'button' | 'submit'
    block?: boolean
    loading?: boolean
    disabled?: boolean
    icon?: IconName
  }>(),
  { variant: 'primary', size: 'md', type: 'button', block: false, loading: false, disabled: false },
)

const VARIANTS = {
  primary: 'bg-brand-700 text-white border-brand-700 hover:bg-brand-800 active:bg-brand-800',
  secondary: 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 active:bg-slate-100',
  ghost: 'bg-transparent text-slate-600 border-transparent hover:bg-slate-100',
  danger: 'bg-white text-red-600 border-red-200 hover:bg-red-50 active:bg-red-100',
} as const

const SIZES = {
  sm: 'min-h-[44px] px-3 text-sm',
  md: 'min-h-[48px] px-4 text-base',
} as const
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
    :class="[VARIANTS[variant], SIZES[size], block && 'w-full']"
  >
    <AppIcon v-if="loading" name="refresh" class="animate-spin" />
    <AppIcon v-else-if="icon" :name="icon" />
    <slot />
  </button>
</template>
