import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// env is a parsed, frozen-at-import object; tests flip NODE_ENV on this stand-in.
const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'development' as string,
  RESEND_API_KEY: undefined as string | undefined,
  RESEND_FROM_EMAIL: undefined as string | undefined,
}))
vi.mock('../schemas/env.js', () => ({ env: mockEnv }))
vi.mock('../utils/metrics.js', () => ({
  meter: { createCounter: () => ({ add: vi.fn() }) },
}))
vi.mock('resend', () => ({ Resend: class {} }))

import { logger } from '../utils/logger.js'
import {
  ConsoleNotificationProvider,
  maskSensitiveValues,
  isDevNotificationPrintEnabled,
} from './providers.js'
import { NotificationChannel } from './types.js'

const payload = {
  channel: NotificationChannel.EMAIL,
  recipient: 'alice@example.com',
  subject: 'Your sign-in code',
  body: 'Your one-time code is 482913. Open https://app.example.com/verify?token=abcDEF1234567890abcDEF1234567890 to continue.',
} as never

describe('ConsoleNotificationProvider logging', () => {
  const originalFlag = process.env.NOTIFICATION_DEV_PRINT

  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.NODE_ENV = 'development'
    delete process.env.NOTIFICATION_DEV_PRINT
  })

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.NOTIFICATION_DEV_PRINT
    else process.env.NOTIFICATION_DEV_PRINT = originalFlag
  })

  it('never calls console.*', async () => {
    process.env.NOTIFICATION_DEV_PRINT = 'true'
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))

    await new ConsoleNotificationProvider().send(payload)

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })

  it('logs the notification through logger.info without its body', async () => {
    await new ConsoleNotificationProvider().send(payload)

    expect(logger.info).toHaveBeenCalledTimes(1)
    const [, fields] = vi.mocked(logger.info).mock.calls[0] as [string, Record<string, unknown>]
    expect(fields).toMatchObject({ recipient: 'alice@example.com', subject: 'Your sign-in code' })
    expect(fields).not.toHaveProperty('body')
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('482913')
  })

  it('prints nothing more by default (dev output is off unless opted in)', async () => {
    await new ConsoleNotificationProvider().send(payload)

    expect(logger.debug).not.toHaveBeenCalled()
    expect(isDevNotificationPrintEnabled()).toBe(false)
  })

  it('does not print for flag values other than "true"', async () => {
    for (const value of ['1', 'yes', 'TRUE', 'false', '']) {
      process.env.NOTIFICATION_DEV_PRINT = value
      await new ConsoleNotificationProvider().send(payload)
    }
    expect(logger.debug).not.toHaveBeenCalled()
  })

  it('prints the body at debug level, masked, when NOTIFICATION_DEV_PRINT=true', async () => {
    process.env.NOTIFICATION_DEV_PRINT = 'true'

    await new ConsoleNotificationProvider().send(payload)

    expect(logger.debug).toHaveBeenCalledTimes(1)
    const [, fields] = vi.mocked(logger.debug).mock.calls[0] as [string, { body: string }]
    expect(fields.body).toContain('one-time code is [REDACTED]')
    expect(fields.body).not.toContain('482913')
    expect(fields.body).not.toContain('abcDEF1234567890abcDEF1234567890')
    // Never at info level, even with the flag on.
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('one-time code')
  })

  it('refuses to run in production and never prints, even with the flag set', async () => {
    mockEnv.NODE_ENV = 'production'
    process.env.NOTIFICATION_DEV_PRINT = 'true'

    await expect(new ConsoleNotificationProvider().send(payload)).rejects.toThrow(/should not be used in production/)

    expect(logger.debug).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(isDevNotificationPrintEnabled()).toBe(false)
  })

  it('handles a notification with no subject or body', async () => {
    process.env.NOTIFICATION_DEV_PRINT = 'true'

    await expect(
      new ConsoleNotificationProvider().send({ channel: NotificationChannel.EMAIL, recipient: 'a@b.co' } as never),
    ).resolves.toBeUndefined()

    const [, fields] = vi.mocked(logger.debug).mock.calls[0] as [string, { subject: string; body: string }]
    expect(fields.subject).toBe('Notification')
    expect(fields.body).toBe('')
  })
})

describe('maskSensitiveValues', () => {
  it('masks one-time codes', () => {
    expect(maskSensitiveValues('Code: 123456')).toBe('Code: [REDACTED]')
    expect(maskSensitiveValues('PIN 1234 or 87654321')).toBe('PIN [REDACTED] or [REDACTED]')
  })

  it('leaves short numbers and ordinary words alone', () => {
    expect(maskSensitiveValues('You have 3 new messages from 12 landlords')).toBe(
      'You have 3 new messages from 12 landlords',
    )
  })

  it('masks credential-like query parameters', () => {
    const masked = maskSensitiveValues('https://x.test/cb?token=abc123&code=zzz&ok=1&secret=s3')
    expect(masked).toContain('token=[REDACTED]')
    expect(masked).toContain('code=[REDACTED]')
    expect(masked).toContain('secret=[REDACTED]')
    expect(masked).toContain('ok=1')
  })

  it('masks long opaque tokens and JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9abcd.eyJzdWIiOiIxMjM0NTY3ODkwIn0abcd.SflKxwRJSMeKKF2QT4fw'
    expect(maskSensitiveValues(`Bearer ${jwt}`)).toBe('Bearer [REDACTED]')
    expect(maskSensitiveValues('key abcdefghijklmnopqrstuvwxyz0123456789')).toBe('key [REDACTED]')
  })

  it('returns an empty string unchanged', () => {
    expect(maskSensitiveValues('')).toBe('')
  })
})
