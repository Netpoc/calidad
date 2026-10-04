<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { http, errorMessage } from '@/api/http'
import AlertBox from '@/components/ui/AlertBox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import type { IconName } from '@/components/ui/icons'
import StatusPill from '@/components/StatusPill.vue'
import {
  BOOKING_STATUS_META,
  PAYMENT_METHOD_META,
  PAYMENT_STAGE_LABELS,
  PAYMENT_STATUS_META,
  userName,
} from '@/api/display'
import {
  SERVICE_TIER_LABELS,
  type Booking,
  type BookingStatus,
  type Branch,
  type Customer,
} from '@/api/types'
import { formatNaira } from '@/composables/useMoney'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useConnectionStore } from '@/stores/connection'
import PaymentModal from './PaymentModal.vue'

const route = useRoute()
const toast = useToast()
const auth = useAuthStore()
const connection = useConnectionStore()

const booking = ref<Booking | null>(null)
const loading = ref(true)
const error = ref('')
const modal = ref<'pay' | 'collect' | 'cancel' | null>(null)
const advancing = ref(false)

const customer = computed(() =>
  booking.value && typeof booking.value.customerId === 'object'
    ? (booking.value.customerId as Customer)
    : null,
)
const branch = computed(() =>
  booking.value && typeof booking.value.branchId === 'object' ? (booking.value.branchId as Branch) : null,
)
const balanceMinor = computed(() =>
  booking.value ? Math.max(0, booking.value.totalMinor - booking.value.paidMinor) : 0,
)
const isOpen = computed(
  () => !!booking.value && booking.value.status !== 'collected' && booking.value.status !== 'cancelled',
)
/** Only legacy data can be collected while owing; its balance can still be taken. */
const owes = computed(() => !!booking.value && booking.value.status !== 'cancelled' && balanceMinor.value > 0)
/** Staff may cancel only while nothing has been paid; refunds are a manager's call. */
const canCancel = computed(
  () => isOpen.value && (booking.value!.paidMinor === 0 || auth.canSeeDashboard),
)

const NEXT_STATUS: Partial<Record<BookingStatus, BookingStatus>> = {
  received: 'in_progress',
  in_progress: 'ready_for_collection',
}

const STATUS_EVENT_TEXT: Record<BookingStatus, string> = {
  received: 'Booked in',
  in_progress: 'Washing started',
  ready_for_collection: 'Marked ready — customer texted',
  collected: 'Handed over to the customer',
  cancelled: 'Booking cancelled',
}

interface TimelineItem {
  key: string
  at: Date
  icon: IconName
  tone: string
  title: string
  detail: string
  /** Breaks ties at the same instant: money before the handover it enabled. */
  order: number
}

/**
 * The audit trail, oldest first: every status change and every movement of
 * money, each with who did it. This is what an owner reads to see who took
 * the deposit, who took the balance and who handed the laundry over.
 */
const timeline = computed<TimelineItem[]>(() => {
  const b = booking.value
  if (!b) return []
  const items: TimelineItem[] = []

  for (const [i, event] of b.statusHistory.entries()) {
    items.push({
      key: `s${i}`,
      at: new Date(event.at),
      icon: BOOKING_STATUS_META[event.status].icon,
      tone: 'bg-slate-100 text-slate-600',
      title: STATUS_EVENT_TEXT[event.status],
      detail: `by ${userName(event.byUserId ?? (event.status === 'received' ? b.createdByUserId : undefined))}`,
      order: 1,
    })
  }

  for (const entry of b.payments) {
    const method = PAYMENT_METHOD_META[entry.method]
    const refund = entry.kind === 'refund'
    items.push({
      key: entry._id,
      at: new Date(entry.at),
      icon: method.icon,
      tone: refund ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700',
      title: `${formatNaira(entry.amountMinor)} ${PAYMENT_STAGE_LABELS[entry.stage].toLowerCase()}${refund ? 'ed' : ''} · ${method.label}`,
      detail: `${refund ? 'given back' : 'taken'} by ${userName(entry.byUserId)}${entry.note ? ` — “${entry.note}”` : ''}`,
      order: 0,
    })
  }

  return items.sort((a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order)
})

function when(date: Date): string {
  return date.toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await http.get<{ booking: Booking }>(`/bookings/${String(route.params.id)}`)
    booking.value = data.booking
  } catch (e) {
    error.value = connection.isOnline ? errorMessage(e) : 'Booking details need a connection.'
  } finally {
    loading.value = false
  }
}

async function advance() {
  const next = booking.value && NEXT_STATUS[booking.value.status]
  if (!next) return
  advancing.value = true
  try {
    await http.patch(`/bookings/${booking.value!._id}/status`, { status: next })
    toast.success(next === 'ready_for_collection' ? 'Marked ready — SMS sent to the customer' : 'Washing started')
    await load()
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    advancing.value = false
  }
}

async function onMoneyDone(_updated: Booking, message: string) {
  modal.value = null
  toast.success(message)
  // Re-read so the timeline shows names, not ids.
  await load()
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-3 p-3">
    <router-link
      :to="{ name: 'bookings' }"
      class="inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold text-slate-600 no-underline"
    >
      <AppIcon name="arrow-left" /> Bookings
    </router-link>

    <AlertBox v-if="error" tone="error">{{ error }}</AlertBox>
    <p v-else-if="loading && !booking" class="text-center text-sm text-slate-500">Loading…</p>

    <template v-if="booking">
      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h1 class="m-0 font-mono text-xl font-bold tracking-wide text-slate-900">
              {{ booking.referenceCode }}
            </h1>
            <router-link
              v-if="customer"
              :to="{ name: 'customer-detail', params: { id: customer._id } }"
              class="m-0 block truncate text-sm font-medium text-brand-700"
            >
              {{ customer.name }}
            </router-link>
            <p class="m-0 text-xs text-slate-500">
              {{ customer?.phone }}<template v-if="branch"> · {{ branch.name }}</template>
            </p>
          </div>
          <div class="flex shrink-0 flex-col items-end gap-1.5">
            <StatusPill :meta="BOOKING_STATUS_META[booking.status]" size="sm" />
            <StatusPill :meta="PAYMENT_STATUS_META[booking.paymentStatus]" size="sm" />
          </div>
        </div>

        <ul class="m-0 mt-3 list-none space-y-1 border-t border-slate-100 p-0 pt-3 text-sm">
          <li v-for="(item, i) in booking.items" :key="i" class="flex justify-between gap-2">
            <span class="min-w-0 text-slate-700">
              {{ item.quantity }} × {{ item.name }}
              <span class="text-xs text-slate-500">· {{ SERVICE_TIER_LABELS[item.tier] }}</span>
            </span>
            <span class="shrink-0 font-medium">{{ formatNaira(item.lineTotalMinor) }}</span>
          </li>
        </ul>

        <dl class="m-0 mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
          <div>
            <dt class="text-xs text-slate-500">Total</dt>
            <dd class="m-0 font-bold text-slate-900">{{ formatNaira(booking.totalMinor) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">Paid</dt>
            <dd class="m-0 font-bold text-green-700">{{ formatNaira(booking.paidMinor) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">Balance</dt>
            <dd class="m-0 font-bold text-amber-700">{{ formatNaira(balanceMinor) }}</dd>
          </div>
        </dl>
        <p v-if="booking.discountMinor > 0" class="m-0 mt-1 text-right text-xs text-slate-500">
          Includes a {{ formatNaira(booking.discountMinor) }} discount
        </p>

        <div v-if="isOpen || owes" class="mt-3 flex flex-col gap-2">
          <div class="flex gap-2">
            <BaseButton
              v-if="owes"
              variant="secondary"
              icon="banknotes"
              class="flex-1"
              :disabled="!connection.isOnline"
              @click="modal = 'pay'"
            >
              Take payment
            </BaseButton>
            <BaseButton
              v-if="booking.status === 'ready_for_collection'"
              class="flex-1"
              :disabled="!connection.isOnline"
              @click="modal = 'collect'"
            >
              {{ BOOKING_STATUS_META.ready_for_collection.action }}
            </BaseButton>
            <BaseButton
              v-else-if="NEXT_STATUS[booking.status]"
              class="flex-1"
              :loading="advancing"
              @click="advance"
            >
              {{ BOOKING_STATUS_META[booking.status].action }}
            </BaseButton>
          </div>
          <BaseButton
            v-if="canCancel"
            variant="danger"
            size="sm"
            :disabled="!connection.isOnline"
            @click="modal = 'cancel'"
          >
            Cancel booking
          </BaseButton>
          <p v-if="!connection.isOnline" class="m-0 text-center text-xs text-slate-500">
            Payments, handover and cancelling need a connection
          </p>
        </div>
      </section>

      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <h2 class="m-0 mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
          <AppIcon name="receipt" /> History
        </h2>
        <ol class="m-0 list-none space-y-3 p-0">
          <li v-for="item in timeline" :key="item.key" class="flex gap-3">
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
              :class="item.tone"
              aria-hidden="true"
            >
              <AppIcon :name="item.icon" />
            </span>
            <div class="min-w-0">
              <p class="m-0 text-sm font-semibold text-slate-900">{{ item.title }}</p>
              <p class="m-0 text-xs text-slate-600">{{ item.detail }}</p>
              <p class="m-0 text-xs text-slate-500">
                <time :datetime="item.at.toISOString()">{{ when(item.at) }}</time>
              </p>
            </div>
          </li>
        </ol>
      </section>
    </template>

    <PaymentModal
      :open="modal !== null"
      :booking="booking"
      :mode="modal ?? 'pay'"
      @close="modal = null"
      @done="onMoneyDone"
    />
  </div>
</template>
