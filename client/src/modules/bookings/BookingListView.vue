<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { http, errorMessage } from '@/api/http'
import AppIcon from '@/components/ui/AppIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useToast } from '@/composables/useToast'
import { BOOKING_STATUS_META, PAYMENT_STATUS_META } from '@/api/display'
import StatusPill from '@/components/StatusPill.vue'
import type { Booking, BookingStatus, Customer } from '@/api/types'
import { formatNaira, plural } from '@/composables/useMoney'
import type { QueuedBooking } from '@/offline/db'
import { foreignOutboxCount, ownOutbox } from '@/offline/session'
import { useAuthStore } from '@/stores/auth'
import { useConnectionStore } from '@/stores/connection'

const toast = useToast()
const auth = useAuthStore()
const connection = useConnectionStore()
const bookings = ref<Booking[]>([])
const queued = ref<QueuedBooking[]>([])
/** Bookings on this device that belong to a different business. */
const foreign = ref(0)
const loading = ref(false)
const filter = ref<BookingStatus | 'all'>('all')

/** The next step a staff member can take, or null at the end of the flow. */
const NEXT_STATUS: Partial<Record<BookingStatus, BookingStatus>> = {
  received: 'in_progress',
  in_progress: 'ready_for_collection',
  ready_for_collection: 'collected',
}

/** Only the states worth filtering by at a counter. */
const FILTERS: Array<{ key: BookingStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'received', label: 'Received' },
  { key: 'in_progress', label: 'Washing' },
  { key: 'ready_for_collection', label: 'Ready' },
]

const visible = computed(() =>
  filter.value === 'all' ? bookings.value : bookings.value.filter((b) => b.status === filter.value),
)

function customerOf(booking: Booking): Customer | null {
  return typeof booking.customerId === 'object' ? booking.customerId : null
}

async function load() {
  loading.value = true
  const tenantId = auth.user?.tenantId ?? null
  queued.value = await ownOutbox(tenantId).toArray()
  foreign.value = await foreignOutboxCount(tenantId)
  try {
    const { data } = await http.get<{ bookings: Booking[] }>('/bookings', {
      params: { limit: 50 },
    })
    bookings.value = data.bookings
  } catch {
    // Offline: only the on-device queue is shown.
  } finally {
    loading.value = false
  }
}

async function advance(booking: Booking) {
  const next = NEXT_STATUS[booking.status]
  if (!next) return
  try {
    const { data } = await http.patch<{ booking: Booking }>(`/bookings/${booking._id}/status`, {
      status: next,
    })
    Object.assign(booking, data.booking)
    toast.success(
      next === 'ready_for_collection'
        ? 'Marked ready — SMS sent to the customer'
        : `Marked ${BOOKING_STATUS_META[next].label.toLowerCase()}`,
    )
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

async function retrySync() {
  await connection.sync()
  await load()
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-3 p-3">
    <!-- Anything still on the device comes first: it is the staff member's
         outstanding work, and invisible to everyone else until it syncs. -->
    <section v-if="queued.length" class="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
      <div class="mb-2 flex items-center gap-2">
        <AppIcon name="cloud-upload" class="text-lg text-amber-700" />
        <h2 class="m-0 flex-1 text-sm font-bold text-amber-900">
          {{ queued.length }} waiting to sync
        </h2>
        <BaseButton size="sm" variant="secondary" :loading="connection.syncing" @click="retrySync">
          Sync now
        </BaseButton>
      </div>
      <div
        v-for="entry in queued"
        :key="entry.clientRequestId"
        class="flex items-center justify-between gap-2 border-t border-amber-200 py-2"
      >
        <div class="min-w-0">
          <p class="m-0 truncate text-sm font-semibold text-amber-900">
            {{ entry.customer.name }}
          </p>
          <p class="m-0 font-mono text-xs text-amber-700">{{ entry.provisionalReference }}</p>
          <p v-if="entry.lastError" class="m-0 flex items-center gap-1 text-xs text-red-700">
            <AppIcon name="warning" />
            {{ entry.lastError }}
          </p>
        </div>
        <span class="shrink-0 text-sm font-bold text-amber-900">
          {{ formatNaira(entry.provisionalTotalMinor) }}
        </span>
      </div>
    </section>

    <!-- Never silently drop another business's queued work; say it is here. -->
    <p v-if="foreign > 0" class="m-0 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
      {{ plural(foreign, 'booking') }} from another business {{ foreign === 1 ? 'is' : 'are' }}
      waiting on this device for that business to sign in.
    </p>

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
        @click="filter = f.key"
      >
        {{ f.label }}
      </button>
      <BaseButton
        size="sm"
        variant="secondary"
        icon="refresh"
        class="ml-auto shrink-0"
        :loading="loading"
        aria-label="Refresh bookings"
        @click="load"
      />
    </div>

    <EmptyState
      v-if="!loading && visible.length === 0"
      icon="list"
      :title="filter === 'all' ? 'No bookings yet' : 'Nothing in this state'"
      hint="Bookings you take at the counter appear here."
    />

    <article
      v-for="booking in visible"
      :key="booking._id"
      class="rounded-xl border border-slate-200 bg-white p-4"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="m-0 font-mono text-base font-bold tracking-wide text-slate-900">
            {{ booking.referenceCode }}
          </p>
          <p class="m-0 truncate text-sm font-medium text-slate-700">
            {{ customerOf(booking)?.name ?? 'Customer' }}
          </p>
          <p class="m-0 text-xs text-slate-500">
            {{ customerOf(booking)?.phone }} · {{ plural(booking.items.length, 'item') }}
          </p>
        </div>
        <div class="shrink-0 text-right">
          <p class="m-0 text-base font-bold text-slate-900">
            {{ formatNaira(booking.totalMinor) }}
          </p>
        </div>
      </div>

      <div class="mt-2.5 flex flex-wrap items-center gap-2">
        <StatusPill :meta="BOOKING_STATUS_META[booking.status]" size="sm" />
        <StatusPill :meta="PAYMENT_STATUS_META[booking.paymentStatus]" size="sm" />
      </div>

      <BaseButton
        v-if="NEXT_STATUS[booking.status]"
        block
        class="mt-3"
        @click="advance(booking)"
      >
        {{ BOOKING_STATUS_META[booking.status].action }}
      </BaseButton>
    </article>
  </div>
</template>
