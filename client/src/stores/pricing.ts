import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http } from '@/api/http'
import type { PriceItem, ServiceTier } from '@/api/types'
import { db, getMeta, setMeta } from '@/offline/db'

/**
 * The price list is the one dataset staff cannot book without, so it is cached
 * in IndexedDB and read from there first. A refresh is attempted in the
 * background; failure is silent, because a stale list still lets work continue.
 */
export const usePricingStore = defineStore('pricing', () => {
  const items = ref<PriceItem[]>([])
  const lastFetchedAt = ref<Date | null>(null)
  const loading = ref(false)

  const byId = computed(() => new Map(items.value.map((item) => [item._id, item])))

  const sorted = computed(() =>
    [...items.value].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
  )

  /** Only the tiers an item actually offers — a null price is "not offered". */
  function tiersFor(item: PriceItem): Array<{ tier: ServiceTier; priceMinor: number }> {
    const tiers: Array<{ tier: ServiceTier; priceMinor: number }> = []
    if (item.washStarchIronMinor != null) {
      tiers.push({ tier: 'wash_starch_iron', priceMinor: item.washStarchIronMinor })
    }
    if (item.starchIronMinor != null) {
      tiers.push({ tier: 'starch_iron', priceMinor: item.starchIronMinor })
    }
    return tiers
  }

  function priceFor(itemId: string, tier: ServiceTier): number | null {
    const item = byId.value.get(itemId)
    if (!item) return null
    return tier === 'wash_starch_iron' ? item.washStarchIronMinor : item.starchIronMinor
  }

  async function loadFromCache(): Promise<void> {
    const cached = await db.priceItems.toArray()
    if (cached.length) {
      items.value = cached
      const at = await getMeta<number>('pricing.fetchedAt')
      lastFetchedAt.value = at ? new Date(at) : null
    }
  }

  async function refresh(branchId?: string): Promise<void> {
    loading.value = true
    try {
      const { data } = await http.get<{ items: PriceItem[] }>('/pricing', {
        params: branchId ? { branchId } : {},
      })
      items.value = data.items
      const now = Date.now()
      await db.priceItems.clear()
      await db.priceItems.bulkPut(data.items.map((item) => ({ ...item, cachedAt: now })))
      await setMeta('pricing.fetchedAt', now)
      lastFetchedAt.value = new Date(now)
    } catch {
      // Offline or server down — the cached list stands.
      if (items.value.length === 0) await loadFromCache()
    } finally {
      loading.value = false
    }
  }

  /** Cache-first: show something immediately, then refresh behind the scenes. */
  async function initialize(branchId?: string): Promise<void> {
    await loadFromCache()
    void refresh(branchId)
  }

  return { items, sorted, byId, loading, lastFetchedAt, tiersFor, priceFor, refresh, initialize }
})
