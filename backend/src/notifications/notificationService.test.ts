import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NotificationService, initNotificationService } from './notificationService.js'
import { NotificationChannel, type NotificationJobPayload } from './types.js'
import { FailoverNotificationProvider } from './providers.js'
import { getScheduler, initScheduler } from '../jobs/scheduler/worker.js'
import { InMemoryJobStore } from '../jobs/scheduler/store.js'
import { JobStatus } from '../jobs/scheduler/types.js'

// Mock Resend to avoid dependency
vi.mock('resend', () => ({
  Resend: class {
    constructor(apiKey: string) {}
    emails = {
      send: vi.fn().mockResolvedValue({ data: { id: 'test-id' } }),
    }
  },
}))

// Mock metrics to avoid OpenTelemetry dependency issues in tests
vi.mock('../utils/metrics.js', () => ({
  meter: {
    createCounter: vi.fn(() => ({
      add: vi.fn(),
    })),
    createHistogram: vi.fn(() => ({
      record: vi.fn(),
    })),
  },
}))

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

// Mock env
vi.mock('../schemas/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    RESEND_API_KEY: 'test-key',
    RESEND_FROM_EMAIL: 'test@example.com',
  },
}))

describe('NotificationService', () => {
  let notificationService: NotificationService
  let mockScheduler: any

  beforeEach(() => {
    // Reset singleton
    const service = new NotificationService()
    initNotificationService(service)
    notificationService = service

    // Mock scheduler
    mockScheduler = {
      schedule: vi.fn(),
    }
    initScheduler(mockScheduler as any)
  })

  describe('enqueue', () => {
    it('should enqueue a notification job', async () => {
      const payload: NotificationJobPayload = {
        channel: NotificationChannel.EMAIL,
        recipient: 'test@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      }

      const mockJob = {
        id: 'job-123',
        name: 'notification_email',
        handler: 'notification.send',
        payload,
        status: JobStatus.PENDING,
      }

      mockScheduler.schedule.mockResolvedValue(mockJob)

      const jobId = await notificationService.enqueue(payload)

      expect(mockScheduler.schedule).toHaveBeenCalledWith({
        name: 'notification_email',
        handler: 'notification.send',
        payload,
        priority: 5,
        maxRetries: 5,
      })
      expect(jobId).toBe('job-123')
    })

    it('should enqueue SMS notification', async () => {
      const payload: NotificationJobPayload = {
        channel: NotificationChannel.SMS,
        recipient: '+1234567890',
        body: 'Test SMS',
      }

      const mockJob = { id: 'job-456' }
      mockScheduler.schedule.mockResolvedValue(mockJob)

      await notificationService.enqueue(payload)

      expect(mockScheduler.schedule).toHaveBeenCalledWith({
        name: 'notification_sms',
        handler: 'notification.send',
        payload,
        priority: 5,
        maxRetries: 5,
      })
    })
  })

  describe('send', () => {
    it('should send email notification via console provider in test', async () => {
      const payload: NotificationJobPayload = {
        channel: NotificationChannel.EMAIL,
        recipient: 'test@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      }

      // Should not throw in test mode (uses console provider)
      await expect(notificationService.send(payload)).resolves.not.toThrow()
    })

    it('should send SMS notification via console provider', async () => {
      const payload: NotificationJobPayload = {
        channel: NotificationChannel.SMS,
        recipient: '+1234567890',
        body: 'Test SMS',
      }

      await expect(notificationService.send(payload)).resolves.not.toThrow()
    })

    it('should send push notification via console provider', async () => {
      const payload: NotificationJobPayload = {
        channel: NotificationChannel.PUSH,
        recipient: 'user-123',
        body: 'Test Push',
      }

      await expect(notificationService.send(payload)).resolves.not.toThrow()
    })

    it('should throw error for unsupported channel', async () => {
      const payload: NotificationJobPayload = {
        channel: 'invalid' as NotificationChannel,
        recipient: 'test@example.com',
        body: 'Test',
      }

      await expect(notificationService.send(payload)).rejects.toThrow(
        'No provider configured for channel'
      )
    })
  })

  describe('failover', () => {
    it('should return failover state for email channel', () => {
      const state = notificationService.getFailoverState()
      
      expect(state).not.toBeNull()
      expect(state).toHaveProperty('useSecondary')
      expect(state).toHaveProperty('failureCount')
    })

    it('should reset failover state', () => {
      notificationService.resetFailover()
      
      const state = notificationService.getFailoverState()
      expect(state?.useSecondary).toBe(false)
      expect(state?.failureCount).toBe(0)
    })
  })
})

describe('FailoverNotificationProvider', () => {
  it('should use primary provider initially', async () => {
    const primary = {
      channel: NotificationChannel.EMAIL,
      send: vi.fn().mockResolvedValue(undefined),
    }
    const secondary = {
      channel: NotificationChannel.EMAIL,
      send: vi.fn().mockResolvedValue(undefined),
    }

    const provider = new FailoverNotificationProvider(primary as any, secondary as any)
    const payload: NotificationJobPayload = {
      channel: NotificationChannel.EMAIL,
      recipient: 'test@example.com',
      body: 'Test',
    }

    await provider.send(payload)

    expect(primary.send).toHaveBeenCalledTimes(1)
    expect(secondary.send).not.toHaveBeenCalled()
  })

  it('should switch to secondary after threshold failures', async () => {
    const primary = {
      channel: NotificationChannel.EMAIL,
      send: vi.fn().mockRejectedValue(new Error('Primary failed')),
    }
    const secondary = {
      channel: NotificationChannel.EMAIL,
      send: vi.fn().mockResolvedValue(undefined),
    }

    const provider = new FailoverNotificationProvider(primary as any, secondary as any)
    const payload: NotificationJobPayload = {
      channel: NotificationChannel.EMAIL,
      recipient: 'test@example.com',
      body: 'Test',
    }

    // Fail 3 times to trigger failover
    for (let i = 0; i < 3; i++) {
      try {
        await provider.send(payload)
      } catch (e) {
        // Expected to fail
      }
    }

    // 4th attempt should use secondary and succeed
    await provider.send(payload)

    expect(primary.send).toHaveBeenCalledTimes(3)
    expect(secondary.send).toHaveBeenCalledTimes(2) // Called once during failover attempt, once for success
  })

  it('should reset failover state', () => {
    const primary = { channel: NotificationChannel.EMAIL, send: vi.fn() }
    const secondary = { channel: NotificationChannel.EMAIL, send: vi.fn() }

    const provider = new FailoverNotificationProvider(primary as any, secondary as any)
    
    // Manually set failover state
    provider['useSecondary'] = true
    provider['failureCount'] = 5

    provider.resetFailover()

    expect(provider['useSecondary']).toBe(false)
    expect(provider['failureCount']).toBe(0)
  })
})
