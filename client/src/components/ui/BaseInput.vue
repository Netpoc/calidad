<script setup lang="ts">
import { useId } from 'vue'
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

/**
 * Labels are always visible, never placeholder-only — a placeholder disappears
 * the moment someone starts typing, which is exactly when they need it.
 */
withDefaults(
  defineProps<{
    label: string
    modelValue: string
    type?: 'text' | 'tel' | 'email' | 'password'
    placeholder?: string
    hint?: string
    error?: string
    icon?: IconName
    autocomplete?: string
    inputmode?: 'text' | 'tel' | 'email' | 'numeric'
  }>(),
  { type: 'text' },
)

defineEmits<{ 'update:modelValue': [string]; blur: [] }>()

const id = useId()
</script>

<template>
  <div>
    <label :for="id" class="mb-1 block text-sm font-medium text-slate-700">{{ label }}</label>
    <div class="relative">
      <AppIcon
        v-if="icon"
        :name="icon"
        class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-slate-400"
      />
      <input
        :id="id"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :inputmode="inputmode"
        :aria-invalid="Boolean(error)"
        :aria-describedby="error || hint ? `${id}-msg` : undefined"
        class="min-h-[48px] w-full rounded-xl border bg-white px-3 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400"
        :class="[
          icon && 'pl-10',
          error
            ? 'border-red-400 focus:border-red-500'
            : 'border-slate-300 focus:border-brand-600',
        ]"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @blur="$emit('blur')"
      />
    </div>
    <!-- The message sits next to the field, not in a summary at the top. -->
    <p v-if="error" :id="`${id}-msg`" class="m-0 mt-1 text-sm font-medium text-red-600">
      {{ error }}
    </p>
    <p v-else-if="hint" :id="`${id}-msg`" class="m-0 mt-1 text-xs text-slate-500">{{ hint }}</p>
  </div>
</template>
