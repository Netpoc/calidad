<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { http } from '@/api/http'
import AppIcon from '@/components/ui/AppIcon.vue'
import AlertBox from '@/components/ui/AlertBox.vue'
import StatCard from '@/components/StatCard.vue'
import type { RevenueSummary } from '@/api/types'
import { formatNaira, plural } from '@/composables/useMoney'
import { useConnectionStore } from '@/stores/connection'

type Period = 'day' | 'month' | 'year'

const connection = useConnectionStore()
const summary = ref<Record<Period, RevenueSummary> | null>(null)
const byBranch = ref<Array<RevenueSummary & { branchId: string; branchName: string }>>([])
const loading = ref(false)
const lastUpdated = ref<Date | null>(null)
const period = ref<Period>('day')

const PERIOD_LABELS: Record<Period, string> = {
  day: 'Today',
  month: 'This month',
  year: 'This year',
}

const current = computed<RevenueSummary | null>(() => summary.value?.[period.value] ?? null)

/** Share of billed money actually in hand — the number a manager acts on. */
const collectedPct = computed(() => {
  const row = current.value
  if (!row || row.billedMinor === 0) return 0
  return Math.round((row.collectedMinor / row.billedMinor) * 100)
})

async function load() {
  if (!connection.isOnline) return
  loading.value = true
  try {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString()
    const [summaryRes, branchRes] = await Promise.all([
      http.get<{ summary: Record<Period, RevenueSummary> }>('/dashboard/summary'),
      http.get<{ branches: typeof byBranch.value }>('/dashboard/branches', {
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
        :caption="plural(current?.bookingCount ?? 0, 'booking')"
      />
      <StatCard
        label="Collected"
        tone="collected"
        icon="check-circle"
        :loading="loading && !summary"
        :value="formatNaira(current?.collectedMinor ?? 0)"
        :caption="`${collectedPct}% of billed`"
      />
      <StatCard
        label="Pending"
        tone="pending"
        icon="clock"
        :loading="loading && !summary"
        :value="formatNaira(current?.pendingMinor ?? 0)"
        caption="Owed by customers"
      />
    </div>

    <!-- Collected vs pending as one bar: the split is easier to judge than two
         numbers, and the figures stay underneath for the exact values. -->
    <div class="rounded-xl border border-slate-200 bg-white p-4">
      <h2 class="m-0 mb-3 text-sm font-bold text-slate-900">
        Collection rate — {{ PERIOD_LABELS[period].toLowerCase() }}
      </h2>
      <div
        class="flex h-3 overflow-hidden rounded-full bg-slate-100"
        role="img"
        :aria-label="`${collectedPct} percent of billed revenue collected`"
      >
        <div class="bg-green-600" :style="{ width: `${collectedPct}%` }" />
        <div class="flex-1 bg-amber-500" />
      </div>
      <div class="mt-2 flex justify-between text-xs">
        <span class="flex items-center gap-1.5 font-medium text-green-700">
          <span class="h-2 w-2 rounded-full bg-green-600" aria-hidden="true" />
          Collected {{ formatNaira(current?.collectedMinor ?? 0) }}
        </span>
        <span class="flex items-center gap-1.5 font-medium text-amber-700">
          <span class="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
          Pending {{ formatNaira(current?.pendingMinor ?? 0) }}
        </span>
      </div>
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
            {{ current?.awaitingCollectionCount ?? 0 }}
          </p>
          <p class="m-0 text-xs text-slate-500">
            Ready and waiting for the customer to collect
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
          <p class="m-0 text-xs text-slate-500">{{ plural(row.bookingCount, 'booking') }}</p>
        </div>
        <div class="shrink-0 text-right">
          <p class="m-0 text-sm font-bold text-brand-700">{{ formatNaira(row.billedMinor) }}</p>
          <p class="m-0 text-xs font-medium text-amber-700">
            {{ formatNaira(row.pendingMinor) }} pending
          </p>
        </div>
      </div>
    </div>

    <p v-if="lastUpdated" class="text-center text-xs text-slate-600">
      Updated {{ lastUpdated.toLocaleTimeString() }} · refreshes automatically
    </p>
  </div>
</template>
