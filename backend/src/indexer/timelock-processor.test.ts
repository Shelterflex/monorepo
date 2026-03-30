import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TimelockProcessor } from './timelock-processor.js'
import { TimelockRepository } from './timelock-repository.js'
import { TimelockEvent } from './event-parser.js'

describe('TimelockProcessor', () => {
  let processor: TimelockProcessor
  let mockRepo: TimelockRepository

  beforeEach(() => {
    mockRepo = {
      upsert: vi.fn().mockResolvedValue(undefined),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      findAll: vi.fn().mockResolvedValue([]),
      getCheckpoint: vi.fn().mockResolvedValue(null),
      saveCheckpoint: vi.fn().mockResolvedValue(undefined),
    }
    processor = new TimelockProcessor(mockRepo)
  })

  it('processes a queued event and updates checkpoint', async () => {
    const events: TimelockEvent[] = [{
      type: 'queued',
      txHash: 'hash1',
      target: 'target1',
      functionName: 'func1',
      args: ['arg1'],
      delay: 1000,
      ledger: 100
    }]

    await processor.processEvents(events)

    expect(mockRepo.upsert).toHaveBeenCalledWith({
      txHash: 'hash1',
      target: 'target1',
      functionName: 'func1',
      args: ['arg1'],
      eta: 1000,
      status: 'queued',
      ledger: 100
    })
    expect(mockRepo.saveCheckpoint).toHaveBeenCalledWith(100)
  })

  it('processes an executed event', async () => {
    const events: TimelockEvent[] = [{
      type: 'executed',
      txHash: 'hash1',
      ledger: 101
    }]

    await processor.processEvents(events)

    expect(mockRepo.updateStatus).toHaveBeenCalledWith('hash1', 'executed', 101)
    expect(mockRepo.saveCheckpoint).toHaveBeenCalledWith(101)
  })

  it('processes a cancelled event', async () => {
    const events: TimelockEvent[] = [{
      type: 'cancelled',
      txHash: 'hash1',
      ledger: 102
    }]

    await processor.processEvents(events)

    expect(mockRepo.updateStatus).toHaveBeenCalledWith('hash1', 'cancelled', 102)
    expect(mockRepo.saveCheckpoint).toHaveBeenCalledWith(102)
  })

  it('handles multiple events in order', async () => {
    const events: TimelockEvent[] = [
      { type: 'queued', txHash: 'h1', target: 't1', functionName: 'f1', args: [], delay: 0, ledger: 100 },
      { type: 'executed', txHash: 'h1', ledger: 101 }
    ]

    await processor.processEvents(events)

    expect(mockRepo.upsert).toHaveBeenCalled()
    expect(mockRepo.updateStatus).toHaveBeenCalledWith('h1', 'executed', 101)
    expect(mockRepo.saveCheckpoint).toHaveBeenCalledWith(101)
  })

  it('handles processing errors gracefully', async () => {
      mockRepo.upsert = vi.fn().mockRejectedValue(new Error('DB failure'))
      const events: TimelockEvent[] = [{ type: 'queued', txHash: 'h1', ledger: 100 } as any]

      await expect(processor.processEvents(events)).resolves.not.toThrow()
  })
})
