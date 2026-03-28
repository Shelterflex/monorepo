import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EmailOtpProvider } from './emailOtpProvider.js'
import { logger } from '../utils/logger.js'

// Mock the dependencies
const mockSend = vi.fn()
vi.mock('resend', () => {
  return {
    Resend: class {
      emails = {
        send: mockSend
      }
    }
  }
})

// Mock env
vi.mock('../schemas/env.js', () => ({
  env: {
    RESEND_API_KEY: 'test-api-key',
    RESEND_FROM_EMAIL: 'sender@test.com'
  }
}))

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn()
  }
}))

describe('EmailOtpProvider', () => {
  let provider: EmailOtpProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new EmailOtpProvider()
  })

  it('sends an OTP email successfully', async () => {
    mockSend.mockResolvedValue({ data: { id: 'test-id' }, error: null })

    await provider.sendOtp('user@example.com', '123456', 5)

    expect(mockSend).toHaveBeenCalledWith({
      from: 'sender@test.com',
      to: 'user@example.com',
      subject: expect.stringContaining('Verification'),
      html: expect.stringContaining('123456'),
    })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Sending Email OTP'), expect.any(Object))
  })

  it('handles resend provider errors', async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: 'Provider busy' } })

    await expect(provider.sendOtp('user@example.com', '123456', 5))
      .rejects.toThrow('Failed to send OTP email via provider')

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Resend provider error'), expect.objectContaining({
      error: 'Provider busy'
    }))
  })

  it('handles unexpected errors', async () => {
    mockSend.mockRejectedValue(new Error('Network failure'))

    await expect(provider.sendOtp('user@example.com', '123456', 5))
      .rejects.toThrow('An unexpected error occurred while sending the OTP email')

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Unexpected error sending email'), expect.objectContaining({
      error: 'Network failure'
    }))
  })

  it('does not log the plaintext OTP', async () => {
    mockSend.mockResolvedValue({ data: { id: 'test-id' }, error: null })
    const otp = 'SECRET123'

    await provider.sendOtp('user@example.com', otp, 5)

    // Check logger.info calls
    const infoCalls = (logger.info as any).mock.calls
    for (const call of infoCalls) {
      const logContent = JSON.stringify(call)
      expect(logContent).not.toContain(otp)
    }

    // Check logger.error calls (just in case)
    const errorCalls = (logger.error as any).mock.calls
    for (const call of errorCalls) {
      const logContent = JSON.stringify(call)
      expect(logContent).not.toContain(otp)
    }
  })
})
