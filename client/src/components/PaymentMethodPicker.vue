<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { PAYMENT_METHOD_META } from '@/api/display'
import { PAYMENT_METHODS, type PaymentMethod } from '@/api/types'

/**
 * Three large choices rather than a dropdown: it is one tap at the counter, and
 * each option carries its icon and word so it never relies on colour.
 */
defineProps<{ modelValue: PaymentMethod | null; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [PaymentMethod] }>()
</script>

<template>
  <fieldset class="m-0 border-0 p-0">
    <legend class="mb-1 p-0 text-sm font-medium text-slate-700">
      {{ label ?? 'How did they pay?' }}
    </legend>
    <div class="grid grid-cols-3 gap-2" role="radiogroup">
      <button
        v-for="method in PAYMENT_METHODS"
        :key="method"
        type="button"
        role="radio"
        :aria-checked="modelValue === method"
        class="tap-card flex min-h-[56px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-sm font-semibold"
        :class="
          modelValue === method
            ? 'border-brand-700 bg-brand-50 text-brand-800'
            : 'border-slate-200 bg-white text-slate-600'
        "
        @click="emit('update:modelValue', method)"
      >
        <AppIcon :name="PAYMENT_METHOD_META[method].icon" class="text-lg" />
        {{ PAYMENT_METHOD_META[method].label }}
      </button>
    </div>
  </fieldset>
</template>
