<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from 'vue'
import { http, errorMessage } from '@/api/http'
import AlertBox from '@/components/ui/AlertBox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { PAYMENT_METHOD_META, PAYMENT_STAGE_LABELS } from '@/api/display'
import type { Branch, LedgerMethod, TillReport } from '@/api/types'
import { formatNaira, plural } from '@/composables/useMoney'
import { useConnectionStore } from '@/stores/connection'

/**
 * The till report: for one day, every naira in or out — who took it, how, on
 * which booking — and every handover. A manager closes the day by checking
 * each person's cash against the drawer and their POS/transfer against slips.
 */
const connection = useConnectionStore()
const dateId = useId()

function todayLocal(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const day = ref(todayLocal())
const branchId = ref('')
const branches = ref<Branch[]>([])
const report = ref<TillReport | null>(null)
const loading = ref(false)
const error = ref('')

const branchOptions = computed(() => [
  { value: '', label: 'All my branches' },
  ...branches.value.map((b) => ({ value: b._id, label: b.name })),
])

/** Modes with any money, in a fixed order. */
const METHODS: LedgerMethod[] = ['cash', 'transfer', 'pos', 'unrecorded']
function nonZero(byMethod: Record<LedgerMethod, number>) {
  return METHODS.filter((m) => byMethod[m] !== 0)
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
}

async function load() {
  if (!connection.isOnline) {
    error.value = 'The till report needs a connection.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const from = new Date(`${day.value}T00:00:00`)
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000)
    const { data } = await http.get<TillReport>('/payments', {
      params: {
        from: from.toISOString(),
        to: to.toISOString(),
        ...(branchId.value ? { branchId: branchId.value } : {}),
      },
    })
    report.value = data
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

watch([day, branchId], load)

onMounted(async () => {
  try {
    const { data } = await http.get<{ branches: Branch[] }>('/branches')
    branches.value = data.branches
  } catch {
    // The report still works across all branches in scope.
  }
  await load()
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-3 p-3">
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div>
        <label :for="dateId" class="mb-1 block text-sm font-medium text-slate-700">Day</label>
        <input
          :id="dateId"
          v-model="day"
          type="date"
          :max="todayLocal()"
          class="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-brand-600"
        />
      </div>
      <BaseSelect
        v-if="branches.length > 1"
        v-model="branchId"
        label="Branch"
        :options="branchOptions"
      />
    </div>

    <AlertBox v-if="error" tone="error">{{ error }}</AlertBox>

    <template v-if="report">
      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <p class="m-0 text-xs font-medium uppercase tracking-wide text-slate-500">Net received</p>
        <p class="m-0 mt-1 text-2xl font-bold text-green-700">
          {{ formatNaira(report.totals.netMinor) }}
        </p>
        <p v-if="report.totals.refundedMinor" class="m-0 text-xs text-slate-500">
          {{ formatNaira(report.totals.inMinor) }} in, {{ formatNaira(report.totals.refundedMinor) }}
          refunded
        </p>
        <ul class="m-0 mt-3 grid list-none grid-cols-3 gap-2 p-0">
          <li
            v-for="m in ['cash', 'transfer', 'pos'] as const"
            :key="m"
            class="rounded-lg border px-2 py-1.5 text-center"
            :class="PAYMENT_METHOD_META[m].classes"
          >
            <p class="m-0 flex items-center justify-center gap-1 text-xs font-semibold">
              <AppIcon :name="PAYMENT_METHOD_META[m].icon" /> {{ PAYMENT_METHOD_META[m].label }}
            </p>
            <p class="m-0 text-sm font-bold">{{ formatNaira(report.totals.byMethod[m]) }}</p>
          </li>
        </ul>
      </section>

      <section v-if="report.totals.byUser.length" class="rounded-xl border border-slate-200 bg-white p-4">
        <h2 class="m-0 mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
          <AppIcon name="users" /> Who should account for what
        </h2>
        <div
          v-for="u in report.totals.byUser"
          :key="u.userId"
          class="flex items-start justify-between gap-2 border-b border-slate-100 py-2 last:border-0"
        >
          <div class="min-w-0">
            <p class="m-0 truncate text-sm font-semibold text-slate-900">{{ u.name }}</p>
            <p class="m-0 text-xs text-slate-500">
              <template v-for="(m, i) in nonZero(u.byMethod)" :key="m">
                <template v-if="i > 0"> · </template>
                {{ PAYMENT_METHOD_META[m].label }} {{ formatNaira(u.byMethod[m]) }}
              </template>
            </p>
          </div>
          <p class="m-0 shrink-0 text-sm font-bold text-slate-900">{{ formatNaira(u.netMinor) }}</p>
        </div>
      </section>

      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <h2 class="m-0 mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
          <AppIcon name="banknotes" /> Payments ({{ report.entries.length }})
        </h2>
        <EmptyState
          v-if="report.entries.length === 0"
          icon="banknotes"
          title="No money taken"
          hint="Deposits, balances and refunds for this day appear here."
        />
        <router-link
          v-for="e in report.entries"
          :key="e.entryId"
          :to="{ name: 'booking-detail', params: { id: e.bookingId } }"
          class="flex items-start justify-between gap-2 border-b border-slate-100 py-2 text-inherit no-underline last:border-0"
        >
          <div class="min-w-0">
            <p class="m-0 text-sm font-semibold text-slate-900">
              <span class="font-mono">{{ e.referenceCode }}</span> · {{ e.customerName }}
            </p>
            <p class="m-0 text-xs text-slate-600">
              {{ PAYMENT_STAGE_LABELS[e.stage] }} · {{ PAYMENT_METHOD_META[e.method].label }} ·
              {{ e.kind === 'refund' ? 'given back' : 'taken' }} by {{ e.byUserName }} ·
              {{ time(e.at) }}
              <template v-if="branches.length > 1"> · {{ e.branchName }}</template>
            </p>
            <p v-if="e.note" class="m-0 text-xs italic text-slate-500">“{{ e.note }}”</p>
          </div>
          <p
            class="m-0 shrink-0 text-sm font-bold"
            :class="e.kind === 'refund' ? 'text-red-700' : 'text-green-700'"
          >
            {{ e.kind === 'refund' ? '−' : '' }}{{ formatNaira(e.amountMinor) }}
          </p>
        </router-link>
      </section>

      <section class="rounded-xl border border-slate-200 bg-white p-4">
        <h2 class="m-0 mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
          <AppIcon name="check-circle" /> Handed over ({{ plural(report.handovers.length, 'booking') }})
        </h2>
        <p v-if="report.handovers.length === 0" class="m-0 text-sm text-slate-500">
          Nothing handed over this day.
        </p>
        <router-link
          v-for="h in report.handovers"
          :key="h.bookingId"
          :to="{ name: 'booking-detail', params: { id: h.bookingId } }"
          class="flex items-start justify-between gap-2 border-b border-slate-100 py-2 text-inherit no-underline last:border-0"
        >
          <div class="min-w-0">
            <p class="m-0 text-sm font-semibold text-slate-900">
              <span class="font-mono">{{ h.referenceCode }}</span> · {{ h.customerName }}
            </p>
            <p class="m-0 text-xs text-slate-600">by {{ h.byUserName }} · {{ time(h.collectedAt) }}</p>
          </div>
          <p class="m-0 shrink-0 text-sm font-medium text-slate-700">{{ formatNaira(h.totalMinor) }}</p>
        </router-link>
      </section>
    </template>
  </div>
</template>
