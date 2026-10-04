<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http, errorMessage } from '@/api/http'
import AlertBox from '@/components/ui/AlertBox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { CustomerWithStats } from '@/api/types'
import { formatNaira, plural } from '@/composables/useMoney'
import { useConnectionStore } from '@/stores/connection'

const route = useRoute()
const router = useRouter()
const connection = useConnectionStore()

// Kept in the URL so "back" from a customer returns to the same results.
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const results = ref<CustomerWithStats[]>([])
const searched = ref('')
const loading = ref(false)
const error = ref('')

let timer: ReturnType<typeof setTimeout> | undefined
let latest = 0

async function run(q: string) {
  const trimmed = q.trim()
  void router.replace({ query: trimmed ? { q: trimmed } : {} })
  if (!trimmed) {
    results.value = []
    searched.value = ''
    return
  }
  // Responses can land out of order while typing; only the newest one counts.
  const ticket = ++latest
  loading.value = true
  error.value = ''
  try {
    const { data } = await http.get<{ customers: CustomerWithStats[] }>('/customers/search', {
      params: { q: trimmed },
    })
    if (ticket !== latest) return
    results.value = data.customers
    searched.value = trimmed
  } catch (e) {
    if (ticket === latest) error.value = errorMessage(e)
  } finally {
    if (ticket === latest) loading.value = false
  }
}

watch(query, (q) => {
  clearTimeout(timer)
  timer = setTimeout(() => run(q), 300)
})
onBeforeUnmount(() => clearTimeout(timer))
if (query.value) void run(query.value)

function formatDate(iso: string | null): string {
  if (!iso) return 'No visits yet'
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-3 p-3">
    <h2 class="m-0 text-lg font-bold text-slate-900">Customers</h2>

    <AlertBox v-if="!connection.isOnline" tone="warning" title="Working offline" icon="cloud">
      Customer search needs a connection.
    </AlertBox>

    <BaseInput
      v-model="query"
      label="Search customers"
      icon="search"
      type="text"
      placeholder="Phone, name, customer ID or ticket ref"
      hint="Part of a phone number works too — try the last four digits."
      autocomplete="off"
    />

    <p v-if="error" class="m-0 text-sm font-medium text-red-600" role="alert">{{ error }}</p>

    <p class="sr-only" aria-live="polite">
      <template v-if="searched && !loading">
        {{ plural(results.length, 'customer') }} found
      </template>
    </p>

    <EmptyState
      v-if="!query.trim()"
      icon="users"
      title="Find a customer"
      hint="Search to see everything they have ever brought in."
    />
    <EmptyState
      v-else-if="searched && !loading && results.length === 0"
      icon="search"
      title="No customers match"
      :hint="`Nothing for “${searched}”. Check the number, or book them as a new customer.`"
    />

    <ul v-else class="m-0 list-none space-y-2 p-0">
      <li v-for="customer in results" :key="customer._id">
        <router-link
          :to="{ name: 'customer-detail', params: { id: customer._id } }"
          class="tap-card flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-inherit no-underline"
        >
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg text-brand-700"
            aria-hidden="true"
          >
            <AppIcon name="user" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="m-0 truncate text-sm font-semibold text-slate-900">{{ customer.name }}</p>
            <p class="m-0 text-xs text-slate-500">
              {{ customer.phone }} · <span class="font-mono">{{ customer.customerId }}</span>
            </p>
            <p class="m-0 text-xs text-slate-500">
              {{ plural(customer.stats.bookingCount, 'visit') }} · last
              {{ formatDate(customer.stats.lastBookingAt) }}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p
              v-if="customer.stats.outstandingMinor > 0"
              class="m-0 flex items-center gap-1 text-xs font-semibold text-amber-700"
            >
              <AppIcon name="warning" />
              {{ formatNaira(customer.stats.outstandingMinor) }} owed
            </p>
            <AppIcon name="chevron-right" class="text-lg text-slate-400" />
          </div>
        </router-link>
      </li>
    </ul>
  </div>
</template>
