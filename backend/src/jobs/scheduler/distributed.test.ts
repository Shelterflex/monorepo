import { describe, it, expect, beforeEach, vi } from 'vitest'
import { InMemoryJobStore, initJobStore } from './store.js'
import { JobScheduler, initScheduler } from './worker.js'
import { JobStatus, JobRunStatus } from './types.js'

describe('Distributed Job Scheduler with Lease Deduplication', () => {
  beforeEach(() => {
    const store = new InMemoryJobStore()
    initJobStore(store)
  })

  describe('Lease-based deduplication', () => {
    it('should prevent multiple workers from executing the same job', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      // Create a job
      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        payload: { data: 'test' },
        nextRunAt: new Date(),
      })

      // Create two schedulers (simulating two workers)
      const scheduler1 = new JobScheduler(1000, 5000)
      const scheduler2 = new JobScheduler(1000, 5000)

      let executionCount = 0
      const handler = vi.fn(async () => {
        executionCount++
        await new Promise(resolve => setTimeout(resolve, 100))
      })

      scheduler1.registerHandler('test-handler', handler)
      scheduler2.registerHandler('test-handler', handler)

      // Both workers try to execute the job
      await scheduler1.tick()
      await scheduler2.tick()

      // Only one should have executed
      expect(executionCount).toBe(1)
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should allow lease renewal by the same worker', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        nextRunAt: new Date(),
      })

      const workerId = 'worker-1'
      const acquired1 = await store.tryAcquireLease(job.id, workerId, 5000)
      expect(acquired1).toBe(true)

      // Same worker can renew
      const acquired2 = await store.tryAcquireLease(job.id, workerId, 5000)
      expect(acquired2).toBe(true)
    })

    it('should reject lease acquisition by different worker', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        nextRunAt: new Date(),
      })

      const worker1 = 'worker-1'
      const worker2 = 'worker-2'

      const acquired1 = await store.tryAcquireLease(job.id, worker1, 5000)
      expect(acquired1).toBe(true)

      const acquired2 = await store.tryAcquireLease(job.id, worker2, 5000)
      expect(acquired2).toBe(false)
    })
  })

  describe('Stale lease recovery', () => {
    it('should recover expired leases', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        nextRunAt: new Date(),
      })

      // Acquire lease with very short TTL
      await store.tryAcquireLease(job.id, 'worker-1', 10)

      // Wait for lease to expire
      await new Promise(resolve => setTimeout(resolve, 20))

      // Recover stale leases
      const recovered = await store.recoverStaleLeases()
      expect(recovered).toBe(1)

      // Another worker should now be able to acquire
      const acquired = await store.tryAcquireLease(job.id, 'worker-2', 5000)
      expect(acquired).toBe(true)
    })

    it('should not recover active leases', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        nextRunAt: new Date(),
      })

      await store.tryAcquireLease(job.id, 'worker-1', 10000)

      // Recover immediately (lease should still be valid)
      const recovered = await store.recoverStaleLeases()
      expect(recovered).toBe(0)

      // Original worker should still hold the lease
      const acquired = await store.tryAcquireLease(job.id, 'worker-2', 5000)
      expect(acquired).toBe(false)
    })
  })

  describe('Job run history', () => {
    it('should record job run start and completion', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        payload: { test: 'data' },
        nextRunAt: new Date(),
      })

      const runId = await store.recordJobRun(
        job.id,
        job.name,
        job.handler,
        'worker-1',
        job.payload,
      )

      expect(runId).toBeTruthy()

      // Add a small delay to ensure measurable duration
      await new Promise(resolve => setTimeout(resolve, 10))

      await store.completeJobRun(runId, JobRunStatus.COMPLETED)

      const history = await store.getJobRunHistory(job.id)
      expect(history).toHaveLength(1)
      expect(history[0].status).toBe(JobRunStatus.COMPLETED)
      expect(history[0].durationMs).toBeGreaterThanOrEqual(0)
      expect(history[0].workerId).toBe('worker-1')
    })

    it('should record job run failure', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        nextRunAt: new Date(),
      })

      const runId = await store.recordJobRun(
        job.id,
        job.name,
        job.handler,
        'worker-1',
        job.payload,
      )

      await store.completeJobRun(runId, JobRunStatus.FAILED, 'Test error')

      const history = await store.getJobRunHistory(job.id)
      expect(history).toHaveLength(1)
      expect(history[0].status).toBe(JobRunStatus.FAILED)
      expect(history[0].errorMessage).toBe('Test error')
    })

    it('should return history in descending order', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        nextRunAt: new Date(),
      })

      // Create multiple runs
      const runId1 = await store.recordJobRun(job.id, job.name, job.handler, 'worker-1', {})
      await new Promise(resolve => setTimeout(resolve, 10))
      const runId2 = await store.recordJobRun(job.id, job.name, job.handler, 'worker-2', {})
      await new Promise(resolve => setTimeout(resolve, 10))
      const runId3 = await store.recordJobRun(job.id, job.name, job.handler, 'worker-3', {})

      await store.completeJobRun(runId1, JobRunStatus.COMPLETED)
      await store.completeJobRun(runId2, JobRunStatus.COMPLETED)
      await store.completeJobRun(runId3, JobRunStatus.COMPLETED)

      const history = await store.getJobRunHistory(job.id)
      expect(history).toHaveLength(3)
      // Most recent first
      expect(history[0].workerId).toBe('worker-3')
      expect(history[1].workerId).toBe('worker-2')
      expect(history[2].workerId).toBe('worker-1')
    })

    it('should respect limit parameter', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        nextRunAt: new Date(),
      })

      // Create 5 runs
      for (let i = 0; i < 5; i++) {
        const runId = await store.recordJobRun(job.id, job.name, job.handler, `worker-${i}`, {})
        await store.completeJobRun(runId, JobRunStatus.COMPLETED)
      }

      const history = await store.getJobRunHistory(job.id, 3)
      expect(history).toHaveLength(3)
    })
  })

  describe('Integration with scheduler', () => {
    it('should track job runs through scheduler execution', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      const scheduler = new JobScheduler(100, 5000)

      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        payload: { test: 'data' },
        nextRunAt: new Date(),
      })

      let handlerCalled = false
      scheduler.registerHandler('test-handler', async (job) => {
        handlerCalled = true
        expect(job.payload).toEqual({ test: 'data' })
      })

      await scheduler.tick()

      expect(handlerCalled).toBe(true)

      const history = await store.getJobRunHistory(job.id)
      expect(history).toHaveLength(1)
      expect(history[0].status).toBe(JobRunStatus.COMPLETED)
      expect(history[0].durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should track failed job runs', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      const scheduler = new JobScheduler(100, 5000)

      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        nextRunAt: new Date(),
        maxRetries: 0,
      })

      scheduler.registerHandler('test-handler', async () => {
        throw new Error('Handler failed')
      })

      await scheduler.tick()

      const history = await store.getJobRunHistory(job.id)
      expect(history).toHaveLength(1)
      expect(history[0].status).toBe(JobRunStatus.FAILED)
      expect(history[0].errorMessage).toBe('Handler failed')
    })
  })

  describe('Lease release', () => {
    it('should release lease after job completion', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        nextRunAt: new Date(),
      })

      await store.tryAcquireLease(job.id, 'worker-1', 5000)
      await store.releaseLease(job.id, 'worker-1')

      const updatedJob = await store.findById(job.id)
      expect(updatedJob?.leaseHolder).toBeNull()
      expect(updatedJob?.leaseExpiresAt).toBeNull()
    })

    it('should not release lease held by different worker', async () => {
      const store = new InMemoryJobStore()
      initJobStore(store)

      const job = await store.create({
        name: 'test-job',
        handler: 'test-handler',
        nextRunAt: new Date(),
      })

      await store.tryAcquireLease(job.id, 'worker-1', 5000)
      await store.releaseLease(job.id, 'worker-2') // Different worker

      const updatedJob = await store.findById(job.id)
      expect(updatedJob?.leaseHolder).toBe('worker-1')
    })
  })
})
