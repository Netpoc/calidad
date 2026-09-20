<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { http } from '@/api/http'
import AppIcon from '@/components/ui/AppIcon.vue'
import AlertBox from '@/components/ui/AlertBox.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import MoneyInput from '@/components/ui/MoneyInput.vue'
import { useToast } from '@/composables/useToast'
import { categoryMeta } from '@/api/display'
import type { Branch, Customer, PriceItem, ServiceTier } from '@/api/types'
import { formatNaira, plural } from '@/composables/useMoney'
import { useAuthStore } from '@/stores/auth'
import { useBookingStore } from '@/stores/booking'
import { useConnectionStore } from '@/stores/connection'
import { usePricingStore } from '@/stores/pricing'

const toast = useToast()
const auth = useAuthStore()
const booking = useBookingStore()
const pricing = usePricingStore()
const connection = useConnectionStore()

const branches = ref<Branch[]>([])
const branchId = ref<string>('')
const search = ref('')
const activeCategory = ref<string>('all')
const lookupLoading = ref(false)
const matchedCustomer = ref<Customer | null>(null)

/** Tier labels are shortened on the buttons — the full name never fits a phone. */
const TIER_SHORT: Record<ServiceTier, string> = {
  wash_starch_iron: 'Wash + Iron',
  starch_iron: 'Iron only',
}

const categories = computed(() => {
  const present = new Set(pricing.sorted.map((item) => item.category || 'general'))
  return [...present]
})

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase()
  return pricing.sorted.filter((item) => {
    const inCategory =
      activeCategory.value === 'all' || (item.category || 'general') === activeCategory.value
    const matchesSearch = !q || item.name.toLowerCase().includes(q)
    return inCategory && matchesSearch
  })
})

const itemCount = computed(() => booking.lines.reduce((sum, line) => sum + line.quantity, 0))

onMounted(async () => {
  try {
    const { data } = await http.get<{ branches: Branch[] }>('/branches')
    branches.value = data.branches
    branchId.value = data.branches[0]?._id ?? ''
  } catch {
    // Offline: reference data comes from the service worker cache.
  }
  await pricing.initialize(branchId.value || undefined)
})

async function lookupCustomer() {
  const phone = booking.customer.phone.trim()
  if (!phone) return
  lookupLoading.value = true
  try {
    const { data } = await http.get<{ customers: Customer[] }>('/customers/search', {
      params: { q: phone },
    })
    const found = data.customers[0]
    if (found) {
      matchedCustomer.value = found
      booking.customer.name = found.name
      if (found.email) booking.customer.email = found.email
      if (found.address) booking.customer.address = found.address
    } else {
      matchedCustomer.value = null
    }
  } catch {
    toast.warning('Cannot check while offline — the customer is matched on sync')
  } finally {
    lookupLoading.value = false
  }
}

function addItem(item: PriceItem, tier: ServiceTier) {
  try {
    booking.addLine(item._id, tier)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not add item')
  }
}

function changeQuantity(index: number, delta: number) {
  const line = booking.lines[index]
  if (!line) return
  const next = line.quantity + delta
  if (next < 1) booking.removeLine(index)
  else line.quantity = next
}

const canSubmit = computed(
  () =>
    !booking.isEmpty &&
    booking.customer.name.trim().length > 0 &&
    booking.customer.phone.trim().length > 0,
)

const confirmation = ref<{ title: string; body: string } | null>(null)

async function submit() {
  try {
    const outcome = await booking.submit(branchId.value)
    matchedCustomer.value = null
    activeCategory.value = 'all'
    search.value = ''
    confirmation.value = {
      title: outcome.queued ? 'Saved on this device' : 'Booking confirmed',
      body: `Reference ${outcome.referenceCode} — ${formatNaira(outcome.totalMinor)}. ${outcome.message}`,
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not save booking')
  }
}

const branchOptions = computed(() =>
  branches.value.map((b) => ({ value: b._id, label: b.name })),
)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-3 p-3 pb-24">
    <AlertBox v-if="!connection.isOnline" tone="warning" title="Working offline" icon="cloud">
      Bookings are saved here and sync automatically when you reconnect.
    </AlertBox>

    <!-- Step 1 -->
    <section class="rounded-xl border border-slate-200 bg-white p-4">
      <h2 class="m-0 mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
        <span
          class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white"
          aria-hidden="true"
        >
          1
        </span>
        Customer
      </h2>

      <div class="mb-3 flex items-end gap-2">
        <BaseInput
          v-model="booking.customer.phone"
          label="Phone number"
          type="tel"
          inputmode="tel"
          placeholder="08031234567"
          class="flex-1"
          @blur="lookupCustomer"
        />
        <BaseButton
          variant="secondary"
          icon="search"
          :loading="lookupLoading"
          aria-label="Look up customer by phone"
          @click="lookupCustomer"
        />
      </div>

      <BaseInput
        v-model="booking.customer.name"
        label="Name"
        placeholder="Customer name"
      />

      <p
        v-if="matchedCustomer"
        class="m-0 mt-2 flex items-center gap-1.5 text-sm font-medium text-green-700"
      >
        <AppIcon name="check-circle" />
        Returning customer · {{ matchedCustomer.customerId }}
      </p>
      <p
        v-else-if="booking.customer.phone.trim() && !lookupLoading"
        class="m-0 mt-2 flex items-center gap-1.5 text-sm text-slate-500"
      >
        <AppIcon name="user" />
        New customer — an ID is created on booking
      </p>
    </section>

    <!-- Step 2 -->
    <section class="rounded-xl border border-slate-200 bg-white p-4">
      <h2 class="m-0 mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
        <span
          class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white"
          aria-hidden="true"
        >
          2
        </span>
        Add items
      </h2>

      <BaseInput
        v-model="search"
        label="Search"
        icon="search"
        :placeholder="`Search ${pricing.sorted.length} items…`"
        class="mb-3"
      />

      <!-- Category chips: a colour cue on top of the name, so staff can jump
           to "Bedding" without reading all 33 rows. Kept on one scrolling row —
           wrapping to three rows pushed the item list off a phone screen. -->
      <div class="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          class="tap-card min-h-[44px] shrink-0 cursor-pointer rounded-full border px-4 text-xs font-semibold"
          :class="
            activeCategory === 'all'
              ? 'border-transparent bg-slate-800 text-white'
              : 'border-slate-200 bg-white text-slate-600'
          "
          @click="activeCategory = 'all'"
        >
          All
        </button>
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          class="tap-card flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-xs font-semibold"
          :class="
            activeCategory === cat
              ? `border-transparent ${categoryMeta(cat).chipActive}`
              : 'border-slate-200 bg-white text-slate-600'
          "
          @click="activeCategory = cat"
        >
          <span
            v-if="activeCategory !== cat"
            class="h-2 w-2 rounded-full"
            :class="categoryMeta(cat).dot"
            aria-hidden="true"
          />
          {{ categoryMeta(cat).label }}
        </button>
      </div>

      <EmptyState
        v-if="pricing.sorted.length === 0 && !pricing.loading && auth.isOwner"
        icon="tag"
        title="No prices yet"
        hint="Add items to the price list before booking laundry."
      >
        <router-link
          to="/pricing"
          class="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-700 px-4 font-semibold text-white no-underline"
        >
          <AppIcon name="tag" /> Set up the price list
        </router-link>
      </EmptyState>
      <EmptyState
        v-else-if="pricing.sorted.length === 0"
        icon="tag"
        title="Price list not available"
        hint="Ask the owner to add items, or connect once to download the list — after that it works offline."
      />
      <p v-else-if="filteredItems.length === 0" class="py-6 text-center text-sm text-slate-500">
        No items match “{{ search }}”
      </p>

      <ul v-else class="m-0 max-h-80 list-none space-y-2 overflow-y-auto p-0">
        <li
          v-for="item in filteredItems"
          :key="item._id"
          class="rounded-lg border border-slate-200 p-2.5"
        >
          <div class="mb-2 flex items-center gap-2">
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-full"
              :class="categoryMeta(item.category || 'general').dot"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
              {{ item.name }}
            </span>
          </div>
          <!-- Only the tiers this item offers. A missing price means the
               service is not available, so no button is drawn for it. -->
          <div class="flex flex-wrap gap-2">
            <button
              v-for="tier in pricing.tiersFor(item)"
              :key="tier.tier"
              type="button"
              class="tap-card min-h-tap flex-1 cursor-pointer rounded-lg border-2 border-brand-100 bg-brand-50 px-3 py-2 text-left"
              @click="addItem(item, tier.tier)"
            >
              <span class="block text-xs font-medium text-brand-700">
                {{ TIER_SHORT[tier.tier] }}
              </span>
              <span class="block text-sm font-bold text-brand-800">
                {{ formatNaira(tier.priceMinor) }}
              </span>
            </button>
          </div>
        </li>
      </ul>
    </section>

    <!-- Step 3 — only once there is something to show. -->
    <section v-if="!booking.isEmpty" class="rounded-xl border border-slate-200 bg-white p-4">
      <h2 class="m-0 mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
        <span
          class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white"
          aria-hidden="true"
        >
          3
        </span>
        Ticket
        <span class="ml-auto text-xs font-medium text-slate-500">{{ plural(itemCount, 'item') }}</span>
      </h2>

      <ul class="m-0 list-none space-y-2 p-0">
        <!-- Two rows per line: item names like "Bed Spread \"A\"" and a stepper
             cannot share one 390px row without truncating the name to nothing. -->
        <li
          v-for="(line, index) in booking.lines"
          :key="`${line.priceItemId}-${line.tier}`"
          class="rounded-lg bg-slate-50 p-2.5"
        >
          <div class="mb-2 flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="m-0 text-sm font-semibold leading-tight text-slate-900">
                {{ line.name }}
              </p>
              <p class="m-0 text-xs text-slate-500">
                {{ TIER_SHORT[line.tier] }} · {{ formatNaira(line.unitPriceMinor) }} each
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-red-500"
              :aria-label="`Remove ${line.name}`"
              @click="booking.removeLine(index)"
            >
              <AppIcon name="trash" />
            </button>
          </div>

          <div class="flex items-center justify-between gap-2">
            <!-- Big steppers instead of a number input: easier to hit than
                 antd's 12px spinner arrows when you are holding a phone. -->
            <div class="flex items-center rounded-lg border border-slate-200 bg-white">
              <button
                type="button"
                class="min-h-tap min-w-tap cursor-pointer rounded-l-lg text-slate-600"
                :aria-label="`Reduce ${line.name}`"
                @click="changeQuantity(index, -1)"
              >
                <AppIcon name="minus" />
              </button>
              <span class="w-8 text-center text-base font-bold">{{ line.quantity }}</span>
              <button
                type="button"
                class="min-h-tap min-w-tap cursor-pointer rounded-r-lg text-brand-700"
                :aria-label="`Add another ${line.name}`"
                @click="changeQuantity(index, 1)"
              >
                <AppIcon name="plus" />
              </button>
            </div>

            <span class="text-base font-bold text-slate-900">
              {{ formatNaira(line.unitPriceMinor * line.quantity) }}
            </span>
          </div>
        </li>
      </ul>

      <div class="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-slate-500">Subtotal</span>
          <span class="font-medium">{{ formatNaira(booking.subtotalMinor) }}</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <MoneyInput v-model="booking.discountMinor" label="Discount" />
          <MoneyInput v-model="booking.paidMinor" label="Paid now" />
        </div>
        <div
          v-if="booking.balanceMinor > 0"
          class="flex justify-between rounded-lg bg-amber-50 px-2.5 py-2 font-semibold text-amber-800"
        >
          <span>Balance due</span>
          <span>{{ formatNaira(booking.balanceMinor) }}</span>
        </div>
      </div>
    </section>

    <BaseSelect
      v-if="branches.length > 1"
      v-model="branchId"
      label="Branch"
      :options="branchOptions"
    />
  </div>

  <!-- Running total stays on screen while items are added, so the staff member
       never scrolls to find out what to charge. Sits above the bottom nav. -->
  <div
    v-if="!booking.isEmpty"
    class="fixed inset-x-0 bottom-[68px] z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur"
  >
    <div class="mx-auto flex max-w-2xl items-center gap-3">
      <div class="min-w-0">
        <p class="m-0 text-xs text-slate-500">{{ plural(itemCount, 'item') }}</p>
        <p class="m-0 text-lg font-bold text-brand-700">{{ formatNaira(booking.totalMinor) }}</p>
      </div>
      <BaseButton
        class="ml-auto flex-1"
        :loading="booking.submitting"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ connection.isOnline ? 'Confirm booking' : 'Save offline' }}
      </BaseButton>
    </div>
    <p v-if="!canSubmit" class="m-0 mt-1.5 text-center text-xs text-slate-500">
      Add the customer’s name and phone number to continue
    </p>
  </div>

  <BaseModal
    :open="confirmation !== null"
    :title="confirmation?.title ?? ''"
    tone="success"
    confirm-label="Next customer"
    @close="confirmation = null"
  >
    {{ confirmation?.body }}
  </BaseModal>
</template>
