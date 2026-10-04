<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http, errorMessage } from '@/api/http'
import AlertBox from '@/components/ui/AlertBox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusPill from '@/components/StatusPill.vue'
import { BOOKING_STATUS_META, PAYMENT_STATUS_META, SERVICE_TIER_SHORT } from '@/api/display'
import type { Booking, BookingStatus, Branch, Customer, CustomerStats } from '@/api/types'
import { formatNaira, plural } from '@/composables/useMoney'
import { useBookingStore } from '@/stores/booking'

const route = useRoute()
const router = useRouter()
const draft = useBookingStore()

const customer = ref<(Customer & { createdAt?: string }) | null>(null)
const bookings = ref<Booking[]>([])
const stats = ref<CustomerStats | null>(null)
const loading = ref(false)
const error = ref('')
const filter = ref<'all' | 'open' | 'owing'>('all')

function balanceOf(booking: Booking): number {
  return booking.status === 'cancelled' ? 0 : Math.max(0, booking.totalMinor - booking.paidMinor)
}

const CLOSED: BookingStatus[] = ['collected', 'cancelled']

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Not collected' },
  { key: 'owing', label: 'Owing' },
] as const

const visible = computed(() => {
  if (filter.value === 'open') return bookings.value.filter((b) => !CLOSED.includes(b.status))
  if (filter.value === 'owing') return bookings.value.filter((b) => balanceOf(b) > 0)
  return bookings.value
})

/** Grouped by month so a long history scans like a statement. */
const byMonth = computed(() => {
  const groups = new Map<string, Booking[]>()
  for (const booking of visible.value) {
    const key = new Date(booking.createdAt).toLocaleDateString('en-NG', {
      month: 'long',
      year: 'numeric',
    })
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(booking)
  }
  return [...groups.entries()]
})

function branchName(booking: Booking): string {
  return typeof booking.branchId === 'object' ? (booking.branchId as Branch).name : ''
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })
}

async function load(id: string) {
  loading.value = true
  error.value = ''
  try {
    const { data } = await http.get<{
      customer: Customer & { createdAt?: string }
      bookings: Booking[]
      stats: CustomerStats
    }>(`/customers/${id}`)
    customer.value = data.customer
    bookings.value = data.bookings
    stats.value = data.stats
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

/** Starts a new ticket with this customer already filled in. */
function bookAgain() {
  if (!customer.value) return
  draft.customer.name = customer.value.name
  draft.customer.phone = customer.value.phone
  draft.customer.email = customer.value.email ?? ''
  draft.customer.address = customer.value.address ?? ''
  void router.push({ name: 'book' })
}

watch(() => route.params.id, (id) => typeof id === 'string' && load(id), { immediate: true })
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-3 p-3">
    <button
      type="button"
      class="inline-flex min-h-tap cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-slate-600"
      @click="router.back()"
    >
      <AppIcon name="arrow-left" /> Back
    </button>

    <AlertBox v-if="error" tone="error">{{ error }}</AlertBox>
    <p v-else-if="loading && !customer" class="text-center text-sm text-slate-500">Loading…</p>

    <template v-if="customer && stats">
      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <div class="flex items-start gap-3">
          <span
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-2xl text-brand-700"
            aria-hidden="true"
          >
            <AppIcon name="user" />
          </span>
          <div class="min-w-0 flex-1">
            <h1 class="m-0 truncate text-lg font-bold text-slate-900">{{ customer.name }}</h1>
            <p class="m-0 text-sm text-slate-600">
              <a :href="`tel:${customer.phone}`" class="text-brand-700">{{ customer.phone }}</a>
            </p>
            <p class="m-0 text-xs text-slate-500">
              ID <span class="font-mono font-semibold">{{ customer.customerId }}</span>
              <template v-if="customer.createdAt">
                · since {{ new Date(customer.createdAt).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' }) }}
              </template>
            </p>
            <p v-if="customer.address" class="m-0 text-xs text-slate-500">{{ customer.address }}</p>
          </div>
        </div>

        <dl class="m-0 mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
          <div>
            <dt class="text-xs text-slate-500">Visits</dt>
            <dd class="m-0 font-bold text-slate-900">{{ stats.bookingCount }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">Spent</dt>
            <dd class="m-0 font-bold text-slate-900">{{ formatNaira(stats.billedMinor) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">Owing</dt>
            <dd
              class="m-0 font-bold"
              :class="stats.outstandingMinor > 0 ? 'text-amber-700' : 'text-slate-900'"
            >
              {{ formatNaira(stats.outstandingMinor) }}
            </dd>
          </div>
        </dl>

        <BaseButton icon="plus-circle" class="mt-3 w-full" @click="bookAgain">
          New booking for {{ customer.name.split(' ')[0] }}
        </BaseButton>
      </section>

      <div class="flex gap-2 overflow-x-auto pb-1">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          type="button"
          class="tap-card min-h-[44px] shrink-0 cursor-pointer rounded-full border px-4 text-xs font-semibold"
          :class="
            filter === f.key
              ? 'border-transparent bg-slate-800 text-white'
              : 'border-slate-200 bg-white text-slate-600'
          "
          :aria-pressed="filter === f.key"
          @click="filter = f.key"
        >
          {{ f.label }}
        </button>
      </div>

      <EmptyState
        v-if="visible.length === 0"
        icon="list"
        :title="bookings.length === 0 ? 'No laundry on record' : 'Nothing here'"
        :hint="
          bookings.length === 0
            ? 'Bookings from branches you can see will show here.'
            : 'No bookings match this filter.'
        "
      />

      <section v-for="[month, group] in byMonth" :key="month" class="space-y-2">
        <h2 class="m-0 px-1 pt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
          {{ month }} · {{ plural(group.length, 'booking') }}
        </h2>
        <router-link
          v-for="booking in group"
          :key="booking._id"
          :to="{ name: 'booking-detail', params: { id: booking._id } }"
          class="tap-card block rounded-xl border border-slate-200 bg-white p-4 text-inherit no-underline"
          :aria-label="`Open booking ${booking.referenceCode}`"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="m-0 font-mono text-base font-bold tracking-wide text-slate-900">
                {{ booking.referenceCode }}
              </p>
              <p class="m-0 text-xs text-slate-500">
                {{ formatDay(booking.createdAt) }}<template v-if="branchName(booking)">
                  · {{ branchName(booking) }}</template
                >
              </p>
            </div>
            <div class="shrink-0 text-right">
              <p class="m-0 text-base font-bold text-slate-900">
                {{ formatNaira(booking.totalMinor) }}
              </p>
              <p v-if="balanceOf(booking) > 0" class="m-0 text-xs font-semibold text-amber-700">
                {{ formatNaira(balanceOf(booking)) }} owed
              </p>
            </div>
          </div>

          <ul class="m-0 mt-2 list-none space-y-0.5 border-t border-slate-100 p-0 pt-2 text-sm">
            <li v-for="(item, i) in booking.items" :key="i" class="flex justify-between gap-2">
              <span class="min-w-0 text-slate-700">
                {{ item.quantity }} × {{ item.name }}
                <span class="text-xs text-slate-500">· {{ SERVICE_TIER_SHORT[item.tier] }}</span>
              </span>
              <span class="shrink-0 text-slate-600">{{ formatNaira(item.lineTotalMinor) }}</span>
            </li>
          </ul>

          <div class="mt-2.5 flex flex-wrap items-center gap-2">
            <StatusPill :meta="BOOKING_STATUS_META[booking.status]" size="sm" />
            <StatusPill
              v-if="booking.status !== 'cancelled'"
              :meta="PAYMENT_STATUS_META[booking.paymentStatus]"
              size="sm"
            />
          </div>
        </router-link>
      </section>
    </template>
  </div>
</template>
