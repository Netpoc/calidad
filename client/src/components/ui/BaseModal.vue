<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import BaseButton from './BaseButton.vue'

const props = defineProps<{
  open: boolean
  title: string
  tone?: 'success' | 'default'
  confirmLabel?: string
}>()

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)

/**
 * Focus moves into the dialog on open and Escape closes it. Without this a
 * keyboard or screen-reader user is left behind on the page underneath.
 */
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await new Promise((r) => requestAnimationFrame(r))
    panel.value?.querySelector<HTMLElement>('button')?.focus()
  },
)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) emit('close')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      @click.self="emit('close')"
    >
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        class="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
      >
        <div
          v-if="tone === 'success'"
          class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-3xl text-green-700"
          aria-hidden="true"
        >
          ✓
        </div>
        <h2 class="m-0 text-center text-lg font-bold text-slate-900">{{ title }}</h2>
        <div class="mt-2 text-center text-sm text-slate-600"><slot /></div>
        <BaseButton block class="mt-5" @click="emit('close')">
          {{ confirmLabel ?? 'Done' }}
        </BaseButton>
      </div>
    </div>
  </Teleport>
</template>
