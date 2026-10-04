<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { http, errorMessage } from '@/api/http'
import AppIcon from '@/components/ui/AppIcon.vue'
import AlertBox from '@/components/ui/AlertBox.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import MoneyInput from '@/components/ui/MoneyInput.vue'
import { useToast } from '@/composables/useToast'
import { CATEGORY_META, SERVICE_TIER_SHORT, categoryMeta } from '@/api/display'
import {
  SERVICE_TIERS,
  TIER_PRICE_FIELD,
  type PriceItem,
  type ServiceTier,
} from '@/api/types'
import { formatNaira } from '@/composables/useMoney'
import { usePricingStore } from '@/stores/pricing'

const toast = useToast()
const pricing = usePricingStore()
const editing = ref<string | null>(null)
const search = ref('')
/** One price per tier; `null` is "not offered", never free. */
type TierPrices = Record<ServiceTier, number | null>

function emptyPrices(): TierPrices {
  return { wash_starch_iron: null, starch_iron: null, iron_only: null }
}

function offersAny(prices: TierPrices): boolean {
  return SERVICE_TIERS.some((tier) => prices[tier] != null)
}

/** The API's field names, e.g. `{ washStarchIronMinor: 50000, ironOnlyMinor: null }`. */
function toPayload(prices: TierPrices) {
  return Object.fromEntries(SERVICE_TIERS.map((tier) => [TIER_PRICE_FIELD[tier], prices[tier]]))
}

/** Chip colour per tier, paired with the tier name so colour is never the only cue. */
const TIER_CHIP: Record<ServiceTier, string> = {
  wash_starch_iron: 'bg-brand-50 text-brand-800',
  starch_iron: 'bg-blue-50 text-blue-800',
  iron_only: 'bg-violet-50 text-violet-800',
}

const draft = ref<TierPrices>(emptyPrices())
const saving = ref(false)

/**
 * New businesses start with an empty list, so adding items is the first thing
 * an owner does — not an afterthought behind "edit".
 */
const showAdd = ref(false)
const adding = ref(false)
const newItem = ref<{ name: string; category: string; prices: TierPrices }>({
  name: '',
  category: 'tops',
  prices: emptyPrices(),
})
const addError = ref('')

const categoryOptions = Object.entries(CATEGORY_META)
  .filter(([key]) => key !== 'general')
  .map(([value, meta]) => ({ value, label: meta.label }))

async function addItem() {
  addError.value = ''
  if (!newItem.value.name.trim()) {
    addError.value = 'Give the item a name'
    return
  }
  if (!offersAny(newItem.value.prices)) {
    addError.value = 'Enter a price for at least one service'
    return
  }
  adding.value = true
  try {
    await http.post('/pricing', {
      name: newItem.value.name.trim(),
      category: newItem.value.category,
      ...toPayload(newItem.value.prices),
    })
    await pricing.refresh()
    toast.success(`${newItem.value.name.trim()} added`)
    newItem.value = { name: '', category: newItem.value.category, prices: emptyPrices() }
    showAdd.value = false
  } catch (e) {
    addError.value = errorMessage(e)
  } finally {
    adding.value = false
  }
}

/** Grouped so an owner edits a whole category without hunting the flat list. */
const grouped = computed(() => {
  const q = search.value.trim().toLowerCase()
  const groups = new Map<string, PriceItem[]>()
  for (const item of pricing.sorted) {
    if (q && !item.name.toLowerCase().includes(q)) continue
    const key = item.category || 'general'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }
  return [...groups.entries()]
})

function startEdit(item: PriceItem) {
  editing.value = item._id
  // `?? null`: items cached before Iron Only existed have no field at all.
  draft.value = Object.fromEntries(
    SERVICE_TIERS.map((tier) => [tier, item[TIER_PRICE_FIELD[tier]] ?? null]),
  ) as TierPrices
}

/**
 * An empty field clears the tier — meaning the service is not offered — rather
 * than setting it to zero, which would make it free.
 */
async function save(item: PriceItem) {
  if (!offersAny(draft.value)) {
    toast.error('An item must offer at least one service')
    return
  }
  saving.value = true
  try {
    await http.patch(`/pricing/${item._id}`, toPayload(draft.value))
    await pricing.refresh()
    editing.value = null
    toast.success(`${item.name} updated`)
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    saving.value = false
  }
}

onMounted(() => pricing.refresh())
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-3 p-3">
    <div class="flex items-center justify-between gap-2">
      <h2 class="m-0 text-lg font-bold text-slate-900">Price list</h2>
      <BaseButton v-if="!showAdd" size="sm" icon="plus" @click="showAdd = true">Add item</BaseButton>
    </div>

    <section v-if="showAdd" class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 class="m-0 text-base font-bold text-slate-900">New item</h3>
      <BaseInput v-model="newItem.name" label="Item name" placeholder="Shirt" />
      <BaseSelect v-model="newItem.category" label="Category" :options="categoryOptions" />
      <MoneyInput
        v-for="tier in SERVICE_TIERS"
        :key="tier"
        v-model="newItem.prices[tier]"
        :label="SERVICE_TIER_SHORT[tier]"
        placeholder="Not offered"
        allow-empty
      />
      <p v-if="addError" class="m-0 text-sm font-medium text-red-600">{{ addError }}</p>
      <div class="flex gap-2 pt-1">
        <BaseButton :loading="adding" @click="addItem">Add to price list</BaseButton>
        <BaseButton variant="secondary" @click="showAdd = false">Cancel</BaseButton>
      </div>
    </section>

    <AlertBox v-if="pricing.sorted.length > 0" tone="info">
      Leave a price blank when the service is not offered for that item. Existing bookings keep
      the price they were charged.
    </AlertBox>

    <EmptyState
      v-if="!pricing.loading && pricing.sorted.length === 0 && !showAdd"
      icon="tag"
      title="No items yet"
      hint="Add your first item to start booking laundry."
    >
      <BaseButton icon="plus" @click="showAdd = true">Add item</BaseButton>
    </EmptyState>

    <BaseInput
      v-if="pricing.sorted.length > 0"
      v-model="search"
      label="Search"
      icon="search"
      placeholder="Search items…"
    />

    <section
      v-for="[category, items] in grouped"
      :key="category"
      class="overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      <h2
        class="m-0 flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-900"
      >
        <span class="h-3 w-3 rounded-full" :class="categoryMeta(category).dot" aria-hidden="true" />
        {{ categoryMeta(category).label }}
        <span class="ml-auto text-xs font-medium text-slate-500">{{ items.length }}</span>
      </h2>

      <div v-for="item in items" :key="item._id" class="border-b border-slate-100 p-3 last:border-0">
        <div class="flex items-center justify-between gap-2">
          <span class="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
            {{ item.name }}
          </span>
          <BaseButton
            v-if="editing !== item._id"
            size="sm"
            variant="secondary"
            icon="edit"
            :aria-label="`Edit ${item.name} prices`"
            @click="startEdit(item)"
          >
            Edit
          </BaseButton>
        </div>

        <div v-if="editing === item._id" class="mt-3 space-y-3">
          <MoneyInput
            v-for="tier in SERVICE_TIERS"
            :key="tier"
            v-model="draft[tier]"
            :label="SERVICE_TIER_SHORT[tier]"
            placeholder="Not offered"
            allow-empty
          />
          <div class="flex gap-2 pt-1">
            <BaseButton :loading="saving" @click="save(item)">Save</BaseButton>
            <BaseButton variant="secondary" @click="editing = null">Cancel</BaseButton>
          </div>
        </div>

        <div v-else class="mt-2 flex flex-wrap gap-2">
          <template v-for="tier in SERVICE_TIERS" :key="tier">
            <span
              v-if="item[TIER_PRICE_FIELD[tier]] != null"
              class="rounded-lg px-2.5 py-1 text-xs font-semibold"
              :class="TIER_CHIP[tier]"
            >
              {{ SERVICE_TIER_SHORT[tier] }} {{ formatNaira(item[TIER_PRICE_FIELD[tier]]!) }}
            </span>
            <span v-else class="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
              {{ SERVICE_TIER_SHORT[tier] }} — not offered
            </span>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>
