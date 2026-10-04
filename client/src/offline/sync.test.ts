import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedBooking as Entry } from './db'

const post = vi.fn()
vi.mock('@/api/http', () => ({
  http: { post: (...args: unknown[]) => post(...args) },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error'),
}))

const { db } = await import('./db')
const { flushOutbox, AUTO_RETRY_LIMIT } = await import('./sync')

const TENANT = 'tenant-a'

function entry(id: string, patch: Partial<Entry> = {}): Entry {
  return {
    clientRequestId: id,
    tenantId: TENANT,
    branchId: 'branch-1',
    customer: { name: 'Ada', phone: '08031234567' },
    items: [{ priceItemId: 'item-1', tier: 'wash_starch_iron', quantity: 1 }],
    provisionalTotalMinor: 50000,
    provisionalReference: 'TMP-ABCDEF',
    createdAt: Date.now(),
    attempts: 0,
    status: 'queued',
    ...patch,
  }
}

/** The server accepts every booking it is sent. */
function serverAcceptsAll() {
  post.mockImplementation(async (_url: string, body: { bookings: Array<{ clientRequestId: string }> }) => ({
    data: {
      results: body.bookings.map((b) => ({
        clientRequestId: b.clientRequestId,
        status: 'created',
        referenceCode: `REF${b.clientRequestId}`,
      })),
    },
  }))
}

function sentIds(): string[] {
  const body = post.mock.calls.at(-1)?.[1] as { bookings: Array<{ clientRequestId: string }> }
  return body.bookings.map((b) => b.clientRequestId).sort()
}

beforeEach(async () => {
  post.mockReset()
  await db.outbox.clear()
  vi.stubGlobal('navigator', { onLine: true })
})

describe('flushOutbox', () => {
  it('sends queued bookings and removes them once the server has them', async () => {
    await db.outbox.bulkPut([entry('a1'), entry('a2')])
    serverAcceptsAll()

    const outcome = await flushOutbox(TENANT)

    expect(outcome.state).toBe('synced')
    expect(sentIds()).toEqual(['a1', 'a2'])
    expect(await db.outbox.count()).toBe(0)
  })

  it('recovers entries left "syncing" when the app was closed mid-request', async () => {
    await db.outbox.put(entry('stuck', { status: 'syncing' }))
    serverAcceptsAll()

    await flushOutbox(TENANT)

    expect(sentIds()).toEqual(['stuck'])
    expect(await db.outbox.count()).toBe(0)
  })

  it('skips exhausted failures in the background but retries them on a manual sync', async () => {
    await db.outbox.put(entry('tired', { status: 'failed', attempts: AUTO_RETRY_LIMIT }))
    serverAcceptsAll()

    expect((await flushOutbox(TENANT)).state).toBe('nothing')
    expect(post).not.toHaveBeenCalled()

    expect((await flushOutbox(TENANT, { manual: true })).state).toBe('synced')
    expect(sentIds()).toEqual(['tired'])
  })

  it('keeps everything, unstuck, when the server cannot be reached', async () => {
    await db.outbox.bulkPut([
      entry('q1'),
      entry('f1', { status: 'failed', attempts: 1, lastError: 'old' }),
    ])
    post.mockRejectedValue(new Error('timeout of 90000ms exceeded'))

    const outcome = await flushOutbox(TENANT)

    expect(outcome).toMatchObject({ state: 'unreachable', error: 'timeout of 90000ms exceeded' })
    const after = Object.fromEntries((await db.outbox.toArray()).map((e) => [e.clientRequestId, e]))
    expect(after.q1).toMatchObject({ status: 'queued', attempts: 0 })
    // A network failure is not the booking's fault: no attempt is used up.
    expect(after.f1).toMatchObject({ status: 'failed', attempts: 1 })
  })

  it('marks a rejected booking failed with the reason, and keeps it', async () => {
    await db.outbox.put(entry('bad'))
    post.mockResolvedValue({
      data: { results: [{ clientRequestId: 'bad', status: 'failed', error: 'branchId is required' }] },
    })

    await flushOutbox(TENANT)

    expect(await db.outbox.get('bad')).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'branchId is required',
    })
  })

  it("never sends another business's bookings", async () => {
    await db.outbox.bulkPut([entry('mine'), entry('theirs', { tenantId: 'tenant-b' })])
    serverAcceptsAll()

    await flushOutbox(TENANT)

    expect(sentIds()).toEqual(['mine'])
    expect(await db.outbox.get('theirs')).toBeDefined()
  })

  it('says it is offline instead of silently doing nothing', async () => {
    await db.outbox.put(entry('a1'))
    vi.stubGlobal('navigator', { onLine: false })

    expect((await flushOutbox(TENANT)).state).toBe('offline')
    expect(post).not.toHaveBeenCalled()
  })
})
