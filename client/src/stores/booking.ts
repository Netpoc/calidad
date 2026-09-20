import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http, errorMessage } from '@/api/http'
import type { Booking, ServiceTier } from '@/api/types'
import { db } from '@/offline/db'
import { usePricingStore } from './pricing'
import { useConnectionStore } from './connection'
import { useAuthStore } from './auth'

export interface DraftLine {
  priceItemId: string
  name: string
  tier: ServiceTier
  quantity: number
  unitPriceMinor: number
}

export interface SubmitOutcome {
  queued: boolean
  referenceCode: string
  totalMinor: number
  message: string
}

/** Local-only placeholder shown on the ticket until the server issues the real
 *  code. Prefixed so it can never be mistaken for a server reference. */
function provisionalReference(): string {
  return `TMP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

function newRequestId(): string {
  return crypto.randomUUID()
}

export const useBookingStore = defineStore('booking', () => {
  const pricing = usePricingStore()
  const connection = useConnectionStore()
  const auth = useAuthStore()

  const lines = ref<DraftLine[]>([])
  const customer = ref({ name: '', phone: '', email: '', address: '' })
  const discountMinor = ref(0)
  const paidMinor = ref(0)
  const submitting = ref(false)

  const subtotalMinor = computed(() =>
    lines.value.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0),
  )
  const totalMinor = computed(() => Math.max(0, subtotalMinor.value - discountMinor.value))
  const balanceMinor = computed(() => Math.max(0, totalMinor.value - paidMinor.value))
  const isEmpty = computed(() => lines.value.length === 0)

  function addLine(priceItemId: string, tier: ServiceTier, quantity = 1): void {
    const price = pricing.priceFor(priceItemId, tier)
    if (price == null) {
      throw new Error('That service is not offered for this item')
    }
    const item = pricing.byId.get(priceItemId)
    if (!item) throw new Error('Unknown item')

    // Same item at the same tier stacks rather than repeating on the ticket.
    const existing = lines.value.find(
      (line) => line.priceItemId === priceItemId && line.tier === tier,
    )
    if (existing) {
      existing.quantity += quantity
      return
    }

    lines.value.push({
      priceItemId,
      name: item.name,
      tier,
      quantity,
      unitPriceMinor: price,
    })
  }

  function removeLine(index: number): void {
    lines.value.splice(index, 1)
  }

  function reset(): void {
    lines.value = []
    customer.value = { name: '', phone: '', email: '', address: '' }
    discountMinor.value = 0
    paidMinor.value = 0
  }

  /**
   * Submits the booking, falling back to the on-device outbox when the API is
   * unreachable. Either way the staff member walks away with a ticket; only the
   * reference code differs, and the provisional one is clearly marked.
   */
  async function submit(branchId: string): Promise<SubmitOutcome> {
    if (isEmpty.value) throw new Error('Add at least one item')
    if (!customer.value.name.trim() || !customer.value.phone.trim()) {
      throw new Error("Enter the customer's name and phone number")
    }
    const tenantId = auth.user?.tenantId
    if (!tenantId) throw new Error('Sign in to a business to book laundry')

    submitting.value = true
    const clientRequestId = newRequestId()
    const payload = {
      clientRequestId,
      branchId,
      customer: {
        name: customer.value.name.trim(),
        phone: customer.value.phone.trim(),
        ...(customer.value.email ? { email: customer.value.email.trim() } : {}),
        ...(customer.value.address ? { address: customer.value.address.trim() } : {}),
      },
      items: lines.value.map((line) => ({
        priceItemId: line.priceItemId,
        tier: line.tier,
        quantity: line.quantity,
      })),
      discountMinor: discountMinor.value,
      paidMinor: paidMinor.value,
    }

    try {
      if (!connection.isOnline) throw new Error('offline')

      const { data } = await http.post<{ booking: Booking }>('/bookings', payload)
      reset()
      return {
        queued: false,
        referenceCode: data.booking.referenceCode,
        totalMinor: data.booking.totalMinor,
        message: 'Booking confirmed. SMS sent to the customer.',
      }
    } catch (error) {
      // A 4xx is the server rejecting the booking on its merits — queueing it
      // would only fail again later, so surface it now while the customer is
      // still at the counter.
      const status = (error as { response?: { status?: number } }).response?.status
      if (status && status >= 400 && status < 500) {
        throw new Error(errorMessage(error))
      }

      const reference = provisionalReference()
      await db.outbox.put({
        ...payload,
        tenantId,
        provisionalTotalMinor: totalMinor.value,
        provisionalReference: reference,
        createdAt: Date.now(),
        attempts: 0,
        status: 'queued',
      })
      await connection.refreshQueueCount()
      const total = totalMinor.value
      reset()
      return {
        queued: true,
        referenceCode: reference,
        totalMinor: total,
        message: 'Saved on this device. It will sync and send the SMS when you are back online.',
      }
    } finally {
      submitting.value = false
    }
  }

  return {
    lines,
    customer,
    discountMinor,
    paidMinor,
    submitting,
    subtotalMinor,
    totalMinor,
    balanceMinor,
    isEmpty,
    addLine,
    removeLine,
    reset,
    submit,
  }
})
