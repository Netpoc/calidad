<script setup lang="ts">
import { computed, useId } from 'vue'

/**
 * Naira in, kobo out. The parent never sees a float — money stays in integer
 * minor units everywhere except this one input.
 *
 * `null` is a real value here: on the price list an empty field means the
 * service is not offered, which is different from being free.
 */
const props = withDefaults(
  defineProps<{
    label: string
    modelValue: number | null
    placeholder?: string
    allowEmpty?: boolean
    hint?: string
  }>(),
  { allowEmpty: false },
)

const emit = defineEmits<{ 'update:modelValue': [number | null] }>()

const id = useId()

const display = computed(() => (props.modelValue == null ? '' : String(props.modelValue / 100)))

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (raw === '') {
    emit('update:modelValue', props.allowEmpty ? null : 0)
    return
  }
  const value = Number(raw)
  if (Number.isFinite(value) && value >= 0) emit('update:modelValue', Math.round(value * 100))
}
</script>

<template>
  <div>
    <label :for="id" class="mb-1 block text-sm font-medium text-slate-700">{{ label }}</label>
    <div class="relative">
      <span
        class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-slate-400"
        aria-hidden="true"
      >
        ₦
      </span>
      <input
        :id="id"
        type="text"
        inputmode="decimal"
        :value="display"
        :placeholder="placeholder"
        class="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white pl-8 pr-3 text-base font-semibold text-slate-900 outline-none transition-colors focus:border-brand-600 placeholder:font-normal placeholder:text-slate-400"
        @input="onInput"
      />
    </div>
    <p v-if="hint" class="m-0 mt-1 text-xs text-slate-500">{{ hint }}</p>
  </div>
</template>
