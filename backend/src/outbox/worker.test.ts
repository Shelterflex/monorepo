import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutboxWorker } from './worker.js'
import { outboxStore } from './store.js'
import { OutboxStatus, TxType } from './types.js'

describe('OutboxWorker retry/backoff', () => {
  beforeEach(async () => {
    await outboxStore.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await outboxStore.clear()
  })

  it('retries transient failures after backoff time is reached', async () => {
    const item = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'manual',
      ref: 'transient-1',
      payload: {
        dealId: 'deal-001',
        amountUsdc: '100.000000',
        tokenAddress: '0x0000000000000000000000000000000000000000',
        txType: TxType.RECEIPT,
      },
    })

    const nextRetryAt = new Date(Date.now() + 30_000)
    await outboxStore.updateStatus(item.id, OutboxStatus.FAILED, {
      error: 'Temporary network timeout',
      nextRetryAt,
    })

    const sender = { send: vi.fn().mockResolvedValue(true) } as any
    const worker = new OutboxWorker(sender)

    await worker.process()
    expect(sender.send).not.toHaveBeenCalled()

    vi.setSystemTime(new Date(nextRetryAt.getTime() + 1))
    await worker.process()
    expect(sender.send).toHaveBeenCalledTimes(1)
    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ id: item.id }))
  })

  it('marks permanently failing items as dead when max retries are exhausted', async () => {
    const item = await outboxStore.create({
      txType: TxType.RECEIPT,
      source: 'manual',
      ref: 'permanent-1',
      payload: {
        dealId: 'deal-002',
        amountUsdc: '50.000000',
        tokenAddress: '0x0000000000000000000000000000000000000000',
        txType: TxType.RECEIPT,
      },
    })

    for (let i = 0; i < 10; i++) {
      await outboxStore.updateStatus(item.id, OutboxStatus.FAILED, {
        error: `Failure ${i + 1}`,
      })
    }

    const sender = { send: vi.fn().mockResolvedValue(false) } as any
    const worker = new OutboxWorker(sender)

    await worker.process()

    const updated = await outboxStore.getById(item.id)
    expect(updated?.status).toBe(OutboxStatus.DEAD)
    expect(updated?.lastError).toBe('Max retry count reached')
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('stops gracefully and does not schedule more processing', async () => {
    const sender = { send: vi.fn().mockResolvedValue(true) } as any
    const worker = new OutboxWorker(sender)

    const processSpy = vi.spyOn(worker, 'process').mockResolvedValue(undefined)

    worker.start(100)
    await vi.advanceTimersByTimeAsync(350)
    const callsBeforeStop = processSpy.mock.calls.length
    expect(callsBeforeStop).toBeGreaterThan(0)

    worker.stop()
    await vi.advanceTimersByTimeAsync(400)
    expect(processSpy.mock.calls.length).toBe(callsBeforeStop)
  })

  it('waits for in-progress operations before resolving stop()', async () => {
    // This test needs real timers due to Promise/setTimeout interaction
    vi.useRealTimers()
    
    let resolveProcessing: (value: void | PromiseLike<void>) => void = () => {}
    const processingPromise = new Promise<void>(resolve => {
      resolveProcessing = resolve
    })

    const sender = { send: vi.fn().mockResolvedValue(true) } as any
    const worker = new OutboxWorker(sender)
    const processSpy = vi.spyOn(worker, 'process').mockReturnValue(processingPromise)

    worker.start(10) // Short interval
    await new Promise(r => setTimeout(r, 50))
    expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1)

    let stopResolved = false
    const stopPromise = worker.stop().then(() => {
      stopResolved = true
    })

    // Should not be resolved yet because processing is still "running"
    await new Promise(r => setTimeout(r, 50))
    expect(stopResolved).toBe(false)

    // Resolve the processing
    resolveProcessing()
    await stopPromise
    expect(stopResolved).toBe(true)
    
    // Restore fake timers for other tests
    vi.useFakeTimers()
  })
})
