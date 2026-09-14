<script setup lang="ts">
import { useId } from 'vue'
import AppIcon from './AppIcon.vue'

/**
 * A native <select>. On a phone this opens the OS picker, which is faster and
 * more familiar than any custom dropdown — and it works without JavaScript
 * gymnastics when the connection is poor.
 */
defineProps<{
  label: string
  modelValue: string
  options: Array<{ value: string; label: string }>
  hint?: string
}>()

defineEmits<{ 'update:modelValue': [string] }>()

const id = useId()
</script>

<template>
  <div>
    <label :for="id" class="mb-1 block text-sm font-medium text-slate-700">{{ label }}</label>
    <div class="relative">
      <select
        :id="id"
        :value="modelValue"
        class="min-h-[48px] w-full cursor-pointer appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-10 text-base text-slate-900 outline-none transition-colors focus:border-brand-600"
        @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <AppIcon
        name="chevron-down"
        class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-lg text-slate-400"
      />
    </div>
    <p v-if="hint" class="m-0 mt-1 text-xs text-slate-500">{{ hint }}</p>
  </div>
</template>
