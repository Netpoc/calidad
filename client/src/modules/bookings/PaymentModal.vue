<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { http, errorMessage } from '@/api/http'
import AlertBox from '@/components/ui/AlertBox.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import MoneyInput from '@/components/ui/MoneyInput.vue'
import PaymentMethodPicker from '@/components/PaymentMethodPicker.vue'
import type { Booking, PaymentMethod } from '@/api/types'
import { formatNaira } from '@/composables/useMoney'
import { useConnectionStore } from '@/stores/connection'
import { uuid } from '@/offline/uuid'

/**
 * Every way money moves on an existing booking, in one dialog:
 *   - `pay`: a deposit, part-payment or the balance, before pickup
 *   - `collect`: hand the laundry over, taking whatever is still owed — the
 *     server refuses to hand over with a balance, so the amount is fixed
 *   - `cancel`: cancel the booking, refunding anything paid
 * The server records who did it and when; this only says how much and how.
 */
const props = defineProps<{
  open: boolean
  booking: Booking | null
  mode: 'pay' | 'collect' | 'cancel'
}>()
const emit = defineEmits<{ close: []; done: [booking: Booking, message: string] }>()

const connection = useConnectionStore()
const amountMinor = ref(0)
const method = ref<PaymentMethod | null>(null)
const note = ref('')
const error = ref('')
const saving = ref(false)
/** Generated once per opening, so a double-tap or retry records one payment. */
let requestId = ''

const balanceMinor = computed(() =>
  props.booking ? Math.max(0, props.booking.totalMinor - props.booking.paidMinor) : 0,
)
const paidMinor = computed(() => props.booking?.paidMinor ?? 0)

/** Whether this action moves money and therefore needs a mode. */
const movesMoney = computed(() => {
  if (props.mode === 'pay') return true
  if (props.mode === 'collect') return balanceMinor.value > 0
  return paidMinor.value > 0
})

const title = computed(() => {
  if (props.mode === 'pay') return 'Take payment'
  if (props.mode === 'collect') return balanceMinor.value > 0 ? 'Take balance and hand over' : 'Hand over laundry'
  return 'Cancel booking'
})

const confirmLabel = computed(() => {
  if (props.mode === 'pay') return `Record ${formatNaira(amountMinor.value)}`
  if (props.mode === 'collect') {
    return balanceMinor.value > 0 ? `Received ${formatNaira(balanceMinor.value)} — hand over` : 'Hand over'
  }
  return paidMinor.value > 0 ? `Refund ${formatNaira(paidMinor.value)} and cancel` : 'Cancel booking'
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    amountMinor.value = balanceMinor.value
    method.value = null
    note.value = ''
    error.value = ''
    requestId = uuid()
  },
)

async function confirm() {
  const booking = props.booking
  if (!booking) return
  error.value = ''
  if (!connection.isOnline) {
    error.value = 'Needs a connection — money is checked against the live balance.'
    return
  }
  if (movesMoney.value && !method.value) {
    error.value = 'Choose how the money was paid.'
    return
  }
  if (props.mode === 'pay' && (amountMinor.value <= 0 || amountMinor.value > balanceMinor.value)) {
    error.value = `Enter an amount up to the balance of ${formatNaira(balanceMinor.value)}.`
    return
  }

  saving.value = true
  const trimmedNote = note.value.trim() || undefined
  try {
    let updated: Booking
    let message: string
    if (props.mode === 'pay') {
      const { data } = await http.post<{ booking: Booking }>(`/bookings/${booking._id}/payments`, {
        amountMinor: amountMinor.value,
        method: method.value,
        note: trimmedNote,
        clientRequestId: requestId,
      })
      updated = data.booking
      const left = updated.totalMinor - updated.paidMinor
      message = left > 0 ? `Payment recorded — ${formatNaira(left)} still owed` : 'Paid in full'
    } else if (props.mode === 'collect') {
      const { data } = await http.post<{ booking: Booking }>(`/bookings/${booking._id}/collect`, {
        payment: movesMoney.value ? { method: method.value, note: trimmedNote } : undefined,
      })
      updated = data.booking
      message = 'Handed over — paid in full'
    } else {
      const { data } = await http.patch<{ booking: Booking }>(`/bookings/${booking._id}/status`, {
        status: 'cancelled',
        refund: movesMoney.value ? { method: method.value, note: trimmedNote } : undefined,
      })
      updated = data.booking
      message = movesMoney.value ? `Cancelled — ${formatNaira(paidMinor.value)} refunded` : 'Booking cancelled'
    }
    emit('done', updated, message)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal :open="open" :title="title" align="left" @close="emit('close')">
    <div v-if="booking" class="space-y-4">
      <dl class="m-0 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
        <div>
          <dt class="text-xs text-slate-500">Total</dt>
          <dd class="m-0 font-bold text-slate-900">{{ formatNaira(booking.totalMinor) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500">Paid</dt>
          <dd class="m-0 font-bold text-green-700">{{ formatNaira(paidMinor) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500">Balance</dt>
          <dd class="m-0 font-bold text-amber-700">{{ formatNaira(balanceMinor) }}</dd>
        </div>
      </dl>

      <MoneyInput
        v-if="mode === 'pay'"
        v-model="amountMinor"
        label="Amount received"
        :hint="`Up to ${formatNaira(balanceMinor)}. Less than that is recorded as a part-payment.`"
      />
      <p v-else-if="mode === 'collect' && movesMoney" class="m-0 text-slate-700">
        Collect the balance of <strong>{{ formatNaira(balanceMinor) }}</strong> before handing the
        laundry over.
      </p>
      <p v-else-if="mode === 'cancel' && movesMoney" class="m-0 text-slate-700">
        The customer has paid <strong>{{ formatNaira(paidMinor) }}</strong>. Give it back, then
        record how.
      </p>
      <p v-else-if="mode === 'collect'" class="m-0 text-slate-700">Fully paid — nothing to take.</p>

      <PaymentMethodPicker
        v-if="movesMoney"
        v-model="method"
        :label="mode === 'cancel' ? 'How was it refunded?' : undefined"
      />

      <BaseInput
        v-if="movesMoney"
        v-model="note"
        :label="mode === 'cancel' ? 'Reason (optional)' : 'Note (optional)'"
        placeholder="e.g. transfer from Zenith, POS slip 0412"
      />

      <AlertBox v-if="error" tone="error">{{ error }}</AlertBox>
    </div>

    <template #actions>
      <BaseButton
        block
        :variant="mode === 'cancel' ? 'danger' : 'primary'"
        :loading="saving"
        :disabled="!connection.isOnline"
        @click="confirm"
      >
        {{ confirmLabel }}
      </BaseButton>
      <BaseButton block variant="ghost" @click="emit('close')">Back</BaseButton>
      <p v-if="!connection.isOnline" class="m-0 text-center text-xs text-slate-500">
        Needs a connection
      </p>
    </template>
  </BaseModal>
</template>
