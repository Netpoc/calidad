<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { http } from '@/api/http'
import AppIcon from '@/components/ui/AppIcon.vue'
import AlertBox from '@/components/ui/AlertBox.vue'
import StatCard from '@/components/StatCard.vue'
import { PAYMENT_METHOD_META } from '@/api/display'
import type { BranchRevenue, LedgerMethod, PeriodRevenue, RevenueHeadline } from '@/api/types'
import { formatNaira, plural } from '@/composables/useMoney'
import { useConnectionStore } from '@/stores/connection'

type Period = 'day' | 'month' | 'year'

const connection = useConnectionStore()
const summary = ref<RevenueHeadline | null>(null)
const byBranch = ref<BranchRevenue[]>([])
const loading = ref(false)
const lastUpdated = ref<Date | null>(null)
const period = ref<Period>('day')

const PERIOD_LABELS: Record<Period, string> = {
  day: 'Today',
  month: 'This month',
  year: 'This year',
}

const current = computed<PeriodRevenue | null>(() => summary.value?.[period.value] ?? null)
const outstanding = computed(() => summary.value?.outstanding ?? null)

/** Modes with money against them, in a fixed order so the bar never reshuffles. */
const METHOD_BAR: Record<LedgerMethod, string> = {
  cash: 'bg-green-600',
  transfer: 'bg-blue-600',
  pos: 'bg-violet-600',
  unrecorded: 'bg-slate-400',
}
const methodSplit = computed(() => {
  const row = current.value
  if (!row) return []
  const total = row.collectedMinor
  return (Object.keys(METHOD_BAR) as LedgerMethod[])
    .filter((m) => row.byMethod[m] !== 0)
    .map((m) => ({
      method: m,
      amountMinor: row.byMethod[m],
      pct: total > 0 ? Math.max(0, Math.round((row.byMethod[m] / total) * 100)) : 0,
    }))
})

async function load() {
  if (!connection.isOnline) return
  loading.value = true
  try {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString()
    const [summaryRes, branchRes] = await Promise.all([
      http.get<{ summary: RevenueHeadline }>('/dashboard/summary'),
      http.get<{ branches: BranchRevenue[] }>('/dashboard/branches', {
        params: { from: startOfYear, to: new Date().toISOString() },
      }),
    ])
    summary.value = summaryRes.data.summary
    byBranch.value = branchRes.data.branches
    lastUpdated.value = new Date()
  } finally {
    loading.value = false
  }
}

/**
 * The brief asks for live figures as customers bring laundry in. Polling keeps
 * that promise without a websocket; 20s is frequent enough for a counter and
 * cheap enough for a phone on mobile data.
 */
let timer: number | undefined
onMounted(() => {
  void load()
  timer = window.setInterval(load, 20_000)
})
onUnmounted(() => window.clearInterval(timer))
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-3 p-3">
    <AlertBox v-if="!connection.isOnline" tone="warning">
      Offline — these figures may be out of date.
    </AlertBox>

    <!-- Period switch: same three figures the brief asks for, one at a time,
         because three periods x four numbers does not fit a phone at once. -->
    <div
      class="flex gap-1 rounded-xl border border-slate-200 bg-white p-1"
      role="tablist"
      aria-label="Reporting period"
    >
      <button
        v-for="(label, key) in PERIOD_LABELS"
        :key="key"
        type="button"
        role="tab"
        :aria-selected="period === key"
        class="tap-card min-h-tap flex-1 cursor-pointer rounded-lg px-3 text-sm font-semibold"
        :class="period === key ? 'bg-brand-700 text-white' : 'bg-transparent text-slate-600'"
        @click="period = key"
      >
        {{ label }}
      </button>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard
        label="Billed"
        tone="billed"
        icon="bank"
        :loading="loading && !summary"
        :value="formatNaira(current?.billedMinor ?? 0)"
        :caption="`${plural(current?.bookingCount ?? 0, 'booking')} taken in`"
      />
      <StatCard
        label="Cash received"
        tone="collected"
        icon="banknotes"
        :loading="loading && !summary"
        :value="formatNaira(current?.collectedMinor ?? 0)"
        :caption="
          current?.refundedMinor
            ? `After ${formatNaira(current.refundedMinor)} refunded`
            : 'Deposits and balances taken'
        "
      />
      <StatCard
        label="Outstanding"
        tone="pending"
        icon="clock"
        :loading="loading && !summary"
        :value="formatNaira(outstanding?.outstandingMinor ?? 0)"
        :caption="`Owed now on ${plural(outstanding?.owingBookingCount ?? 0, 'booking')}`"
      />
    </div>

    <!-- How the money came in. Each segment is named with its amount below,
         so the colours are a shortcut, never the only signal. -->
    <div class="rounded-xl border border-slate-200 bg-white p-4">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 class="m-0 text-sm font-bold text-slate-900">
          Received by mode — {{ PERIOD_LABELS[period].toLowerCase() }}
        </h2>
        <router-link
          :to="{ name: 'payments' }"
          class="flex min-h-tap items-center gap-1 text-sm font-semibold text-brand-700 no-underline"
        >
          Till report <AppIcon name="chevron-right" />
        </router-link>
      </div>
      <p v-if="methodSplit.length === 0" class="m-0 text-sm text-slate-500">
        No money taken {{ PERIOD_LABELS[period].toLowerCase() }} yet.
      </p>
      <template v-else>
        <div
          class="flex h-3 overflow-hidden rounded-full bg-slate-100"
          role="img"
          :aria-label="
            methodSplit.map((m) => `${PAYMENT_METHOD_META[m.method].label} ${m.pct}%`).join(', ')
          "
        >
          <div
            v-for="m in methodSplit"
            :key="m.method"
            :class="METHOD_BAR[m.method]"
            :style="{ width: `${m.pct}%` }"
          />
        </div>
        <ul class="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs">
          <li
            v-for="m in methodSplit"
            :key="m.method"
            class="flex items-center gap-1.5 font-medium text-slate-700"
          >
            <AppIcon :name="PAYMENT_METHOD_META[m.method].icon" />
            {{ PAYMENT_METHOD_META[m.method].label }} {{ formatNaira(m.amountMinor) }}
          </li>
        </ul>
      </template>
    </div>

    <div class="rounded-xl border border-slate-200 bg-white p-4">
      <div class="flex items-center gap-3">
        <span
          class="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-xl text-blue-600"
          aria-hidden="true"
        >
          <AppIcon name="inbox" />
        </span>
        <div>
          <p class="m-0 text-2xl font-bold text-slate-900">
            {{ outstanding?.awaitingCollectionCount ?? 0 }}
          </p>
          <p class="m-0 text-xs text-slate-500">
            Ready and waiting for the customer
            <template v-if="outstanding?.awaitingCollectionBalanceMinor">
              · {{ formatNaira(outstanding.awaitingCollectionBalanceMinor) }} to take at pickup
            </template>
          </p>
        </div>
      </div>
    </div>

    <div v-if="byBranch.length > 1" class="rounded-xl border border-slate-200 bg-white p-4">
      <h2 class="m-0 mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
        <AppIcon name="store" />
        By branch — year to date
      </h2>
      <div
        v-for="row in byBranch"
        :key="row.branchId"
        class="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0"
      >
        <div class="min-w-0">
          <p class="m-0 truncate text-sm font-semibold text-slate-900">{{ row.branchName }}</p>
          <p class="m-0 text-xs text-slate-500">
            {{ plural(row.bookingCount, 'booking') }} · billed {{ formatNaira(row.billedMinor) }}
          </p>
        </div>
        <div class="shrink-0 text-right">
          <p class="m-0 text-sm font-bold text-green-700">
            {{ formatNaira(row.collectedMinor) }} received
          </p>
          <p class="m-0 text-xs font-medium text-amber-700">
            {{ formatNaira(row.outstandingMinor) }} owed now
          </p>
        </div>
      </div>
    </div>

    <p v-if="lastUpdated" class="text-center text-xs text-slate-600">
      Updated {{ lastUpdated.toLocaleTimeString() }} · refreshes automatically
    </p>
  </div>
</template>
