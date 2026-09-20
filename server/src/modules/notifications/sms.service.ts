import { env } from '../../config/env.js'
import { SmsLogModel } from './sms-log.model.js'

export interface SmsDriver {
  readonly name: string
  send(to: string, message: string): Promise<{ providerId?: string }>
}

/** Development default: records the message instead of spending credit. */
const logDriver: SmsDriver = {
  name: 'log',
  async send(to, message) {
    console.log(`[sms:${env.SMS_SENDER_ID}] -> ${to}: ${message}`)
    return {}
  },
}

const drivers: Record<string, SmsDriver> = { log: logDriver }

export function getDriver(): SmsDriver {
  return drivers[env.SMS_DRIVER] ?? logDriver
}

/**
 * SMS fires on exactly two transitions (CLAUDE.md): booking completed, and
 * status -> ready_for_collection.
 *
 * `dedupeKey` makes sending idempotent. Offline bookings are replayed on
 * reconnect, and a customer who gets the same "your laundry is ready" text
 * three times loses confidence in the business, so the key is stored with a
 * unique index and a repeat send is skipped rather than re-sent.
 */
export async function sendSms(params: {
  tenantId: string
  to: string
  message: string
  dedupeKey: string
  bookingId?: string
}): Promise<{ sent: boolean; reason?: string }> {
  const existing = await SmsLogModel.findOne({ dedupeKey: params.dedupeKey })
  if (existing) {
    return { sent: false, reason: 'already-sent' }
  }

  const driver = getDriver()
  const log = await SmsLogModel.create({
    tenantId: params.tenantId,
    to: params.to,
    message: params.message,
    dedupeKey: params.dedupeKey,
    bookingId: params.bookingId ?? null,
    driver: driver.name,
    status: 'pending',
  })

  try {
    const result = await driver.send(params.to, params.message)
    log.status = 'sent'
    log.providerId = result.providerId ?? ''
    log.sentAt = new Date()
    await log.save()
    return { sent: true }
  } catch (error) {
    log.status = 'failed'
    log.error = error instanceof Error ? error.message : String(error)
    await log.save()
    // Delivery is best-effort: a failed SMS must not fail the booking.
    return { sent: false, reason: log.error }
  }
}

/** The business name leads: the customer knows the laundry, not our platform. */
export function bookingConfirmedMessage(params: {
  customerName: string
  referenceCode: string
  totalMinor: number
  businessName: string
  branchName: string
}): string {
  return (
    `Hi ${params.customerName}, your laundry is booked with ${params.businessName} ` +
    `(${params.branchName}). ` +
    `Ref: ${params.referenceCode}. Total: ${formatNaira(params.totalMinor)}. ` +
    `Quote this reference on collection.`
  )
}

export function readyForCollectionMessage(params: {
  customerName: string
  referenceCode: string
  balanceMinor: number
  businessName: string
  branchName: string
}): string {
  const balance =
    params.balanceMinor > 0 ? ` Outstanding balance: ${formatNaira(params.balanceMinor)}.` : ''
  return (
    `Hi ${params.customerName}, your laundry (Ref: ${params.referenceCode}) is ready for ` +
    `collection at ${params.businessName}, ${params.branchName}.${balance}`
  )
}

export function formatNaira(minor: number): string {
  return `NGN ${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
}
