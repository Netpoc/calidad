<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { useToast, type ToastTone } from '@/composables/useToast'

const { toasts, dismiss, iconFor } = useToast()

const TONES: Record<ToastTone, string> = {
  success: 'bg-green-50 border-green-300 text-green-900',
  error: 'bg-red-50 border-red-300 text-red-900',
  info: 'bg-blue-50 border-blue-300 text-blue-900',
  warning: 'bg-amber-50 border-amber-300 text-amber-900',
}
</script>

<template>
  <!-- Toasts appear at the top: the bottom of the screen is occupied by the
       running-total bar and the nav, and a phone keyboard covers it anyway. -->
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-0 top-2 z-[60] flex flex-col items-center gap-2 px-3"
      role="status"
      aria-live="polite"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border-2 px-3.5 py-3 shadow-lg"
        :class="TONES[toast.tone]"
      >
        <AppIcon :name="iconFor(toast.tone)" class="mt-0.5 text-lg" />
        <p class="m-0 flex-1 text-sm font-medium">{{ toast.message }}</p>
        <button
          type="button"
          class="cursor-pointer rounded p-1 opacity-60 hover:opacity-100"
          aria-label="Dismiss"
          @click="dismiss(toast.id)"
        >
          <AppIcon name="x" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
