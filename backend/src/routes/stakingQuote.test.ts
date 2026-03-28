// Set test environment variables before imports
process.env.QUOTE_EXPIRY_MS = '50'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { quoteStore } from '../models/quoteStore.js'
import { depositStore } from '../models/depositStore.js'
import { sessionStore, userStore } from '../models/authStore.js'
import { env } from '../schemas/env.js'

// Override the env value for tests
;(env as any).QUOTE_EXPIRY_MS = 50

// Test helper interfaces
interface TestQuoteOptions {
  amountNgn?: number
  paymentRail?: string
}

interface TestDepositOptions {
  paymentRail?: string
  customerMeta?: Record<string, any>
}

// Test helper functions
async function createTestQuote(
  app: any,
  authToken: string,
  options: TestQuoteOptions = {}
): Promise<{ quoteId: string; expiresAt: string }> {
  const response = await request(app)
    .post('/api/staking/quote')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      amountNgn: options.amountNgn ?? 160000,
      paymentRail: options.paymentRail ?? 'manual_admin',
    })
    .expect(201)

  return {
    quoteId: response.body.quoteId,
    expiresAt: response.body.expiresAt,
  }
}

async function attemptDeposit(
  app: any,
  userId: string,
  quoteId: string,
  options: TestDepositOptions = {}
) {
  return request(app)
    .post('/api/staking/deposit/initiate')
    .set('x-user-id', userId)
    .set('x-amount-ngn', '160000')
    .send({
      quoteId,
      paymentRail: options.paymentRail ?? 'manual_admin',
      ...(options.customerMeta && { customerMeta: options.customerMeta }),
    })
}

describe('Staking Quote API', () => {
  let app: any
  let authToken: string
  let userId: string

  beforeEach(async () => {
    vi.useFakeTimers()
    process.env.QUOTE_EXPIRY_MS = '50'
    app = createApp()
    await quoteStore.clear()
    await depositStore.clear()
    const email = 'quote-test@example.com'
    const user = await userStore.getOrCreateByEmail(email)
    userId = user.id
    authToken = 'test-token-quote'
    await sessionStore.create(email, authToken)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a quote and rejects reuse', async () => {
    const q = await request(app)
      .post('/api/staking/quote')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amountNgn: 160000, paymentRail: 'manual_admin' })
      .expect(201)
    expect(q.body.quoteId).toBeDefined()
    expect(q.body.estimatedAmountUsdc).toMatch(/^\d+\.\d{6}$/)
    const quoteId = q.body.quoteId
    const init1 = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .set('x-amount-ngn', '160000')
      .send({ quoteId, paymentRail: 'manual_admin' })
      .expect(201)
    expect(init1.body.success).toBe(true)
    await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .set('x-amount-ngn', '160000')
      .send({ quoteId, paymentRail: 'manual_admin' })
      .expect(409)
  })

  it('rejects expired quote', async () => {
    const q = await request(app)
      .post('/api/staking/quote')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amountNgn: 160000, paymentRail: 'manual_admin' })
      .expect(201)
    const quoteId = q.body.quoteId
    await quoteStore.markExpired(quoteId)
    await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .set('x-amount-ngn', '160000')
      .send({ quoteId, paymentRail: 'manual_admin' })
      .expect(409)
  })

  it('rejects missing x-user-id header for deposit initiation', async () => {
    const q = await request(app)
      .post('/api/staking/quote')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amountNgn: 160000, paymentRail: 'manual_admin' })
      .expect(201)

    const response = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-amount-ngn', '160000')
      .send({ quoteId: q.body.quoteId, paymentRail: 'manual_admin' })
      .expect(400)

    expect(response.body.error?.message).toBe('Missing x-user-id header')
  })

  it('rejects invalid x-user-id header for deposit initiation', async () => {
    const q = await request(app)
      .post('/api/staking/quote')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amountNgn: 160000, paymentRail: 'manual_admin' })
      .expect(201)

    const response = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', 'bad user id!')
      .set('x-amount-ngn', '160000')
      .send({ quoteId: q.body.quoteId, paymentRail: 'manual_admin' })
      .expect(400)

    expect(response.body.error?.message).toBe(
      'Invalid x-user-id header: expected 3-128 chars of letters, numbers, underscore, or hyphen'
    )
  })
})

describe('Quote Expiry - Time-Based Rejection', () => {
  let app: any
  let authToken: string
  let userId: string

  beforeEach(async () => {
    vi.useFakeTimers()
    process.env.QUOTE_EXPIRY_MS = '50'
    app = createApp()
    await quoteStore.clear()
    await depositStore.clear()
    const email = 'expiry-test@example.com'
    const user = await userStore.getOrCreateByEmail(email)
    userId = user.id
    authToken = 'test-token-expiry'
    await sessionStore.create(email, authToken)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects expired quote with 409 and marks it expired', async () => {
    // Set initial time
    const startTime = Date.now()
    vi.setSystemTime(startTime)

    // Create quote with 50ms expiry
    const { quoteId } = await createTestQuote(app, authToken)

    // Advance time past expiry
    vi.setSystemTime(startTime + 51)

    // Attempt deposit
    const response = await attemptDeposit(app, userId, quoteId)
    expect(response.status).toBe(409)

    // Verify error message
    expect(response.body.error?.message).toContain('expired')

    // Verify quote was marked expired
    const quote = await quoteStore.getById(quoteId)
    expect(quote?.status).toBe('expired')
  })
})

describe('Quote Expiry - Status Transitions', () => {
  let app: any
  let authToken: string
  let userId: string

  beforeEach(async () => {
    vi.useFakeTimers()
    process.env.QUOTE_EXPIRY_MS = '50'
    app = createApp()
    await quoteStore.clear()
    await depositStore.clear()
    const email = 'status-test@example.com'
    const user = await userStore.getOrCreateByEmail(email)
    userId = user.id
    authToken = 'test-token-status'
    await sessionStore.create(email, authToken)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('transitions active quote to expired and updates timestamp', async () => {
    // Create quote
    const { quoteId } = await createTestQuote(app, authToken)

    const before = await quoteStore.getById(quoteId)
    expect(before?.status).toBe('active')
    const originalUpdatedAt = before?.updatedAt

    // Mark expired
    await quoteStore.markExpired(quoteId)

    // Verify status and timestamp
    const after = await quoteStore.getById(quoteId)
    expect(after?.status).toBe('expired')
    expect(after?.updatedAt.getTime()).toBeGreaterThanOrEqual(
      originalUpdatedAt!.getTime()
    )
  })

  it('markExpired is idempotent', async () => {
    // Create quote and mark as expired
    const { quoteId } = await createTestQuote(app, authToken)
    
    const result1 = await quoteStore.markExpired(quoteId)
    expect(result1?.status).toBe('expired')
    
    // Call markExpired again on same quote
    const result2 = await quoteStore.markExpired(quoteId)
    
    // Verify status remains 'expired'
    expect(result2?.status).toBe('expired')
    
    // Verify operation returns same result
    expect(result1?.quoteId).toBe(result2?.quoteId)
    expect(result2?.status).toBe('expired')
  })

  it('markExpired returns null for non-existent quote', async () => {
    // Call markExpired with non-existent quote ID
    const result = await quoteStore.markExpired('non-existent-quote-id')
    
    // Verify null is returned
    expect(result).toBeNull()
  })
})

describe('Quote Expiry - Reuse Prevention', () => {
  let app: any
  let authToken: string
  let userId: string

  beforeEach(async () => {
    vi.useFakeTimers()
    process.env.QUOTE_EXPIRY_MS = '50'
    app = createApp()
    await quoteStore.clear()
    await depositStore.clear()
    const email = 'reuse-test@example.com'
    const user = await userStore.getOrCreateByEmail(email)
    userId = user.id
    authToken = 'test-token-reuse'
    await sessionStore.create(email, authToken)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prevents reuse of expired quote on multiple attempts', async () => {
    // Create quote and mark as expired
    const { quoteId } = await createTestQuote(app, authToken)
    await quoteStore.markExpired(quoteId)

    // Attempt deposit with expired quote
    const response1 = await attemptDeposit(app, userId, quoteId)
    
    // Verify 409 rejection
    expect(response1.status).toBe(409)
    expect(response1.body.error?.message).toContain('expired')

    // Attempt second deposit with same quote
    const response2 = await attemptDeposit(app, userId, quoteId)
    
    // Verify second attempt also rejected
    expect(response2.status).toBe(409)
    expect(response2.body.error?.message).toContain('expired')
  })

  it('preserves used status when marking expired', async () => {
    // Create quote and use it successfully (deposit initiation)
    const { quoteId } = await createTestQuote(app, authToken)
    const response = await attemptDeposit(app, userId, quoteId)
    expect(response.status).toBe(201)

    // Verify status is 'used'
    const usedQuote = await quoteStore.getById(quoteId)
    expect(usedQuote?.status).toBe('used')

    // Call markExpired() on used quote
    await quoteStore.markExpired(quoteId)

    // Verify status remains 'used' (not changed to expired)
    const afterMarkExpired = await quoteStore.getById(quoteId)
    expect(afterMarkExpired?.status).toBe('used')
  })
})

describe('Quote Expiry - Boundary Conditions', () => {
  let app: any
  let authToken: string
  let userId: string

  beforeEach(async () => {
    vi.useFakeTimers()
    process.env.QUOTE_EXPIRY_MS = '50'
    app = createApp()
    await quoteStore.clear()
    await depositStore.clear()
    const email = 'boundary-test@example.com'
    const user = await userStore.getOrCreateByEmail(email)
    userId = user.id
    authToken = 'test-token-boundary'
    await sessionStore.create(email, authToken)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    { name: 'exactly at expiry', offsetMs: 0, shouldReject: true, expectedStatus: 409 },
    { name: 'one ms before expiry', offsetMs: -1, shouldReject: false, expectedStatus: 201 },
    { name: 'one ms after expiry', offsetMs: 1, shouldReject: true, expectedStatus: 409 },
  ])('handles deposit attempt $name', async ({ offsetMs, shouldReject, expectedStatus }) => {
    // Set initial time
    const startTime = Date.now()
    vi.setSystemTime(startTime)

    // Create quote with 50ms expiry
    const { quoteId } = await createTestQuote(app, authToken)

    // Advance time to boundary (50ms + offset)
    const expiryMs = 50
    vi.setSystemTime(startTime + expiryMs + offsetMs)

    // Attempt deposit
    const response = await attemptDeposit(app, userId, quoteId)

    // Verify expected status
    expect(response.status).toBe(expectedStatus)

    if (shouldReject) {
      // Verify error message for rejected requests
      expect(response.body.error?.message).toContain('expired')
    } else {
      // Verify success for accepted requests
      expect(response.body.success).toBe(true)
    }
  })
})

describe('Quote Expiry - Edge Cases', () => {
  let app: any
  let authToken: string
  let userId: string

  beforeEach(async () => {
    vi.useFakeTimers()
    app = createApp()
    await quoteStore.clear()
    await depositStore.clear()
    const email = 'edge-case-test@example.com'
    const user = await userStore.getOrCreateByEmail(email)
    userId = user.id
    authToken = 'test-token-edge-case'
    await sessionStore.create(email, authToken)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    { name: 'zero expiry', expiryMs: 0 },
    { name: 'negative expiry', expiryMs: -1000 },
  ])('immediately expires quote with $name', async ({ expiryMs }) => {
    // Set the expiry time for this test
    process.env.QUOTE_EXPIRY_MS = String(expiryMs)
    ;(env as any).QUOTE_EXPIRY_MS = expiryMs

    // Set initial time
    const startTime = Date.now()
    vi.setSystemTime(startTime)

    // Create quote - should be immediately expired
    const { quoteId } = await createTestQuote(app, authToken)

    // No time advancement needed - quote should already be expired
    const response = await attemptDeposit(app, userId, quoteId)

    // Verify quote is immediately expired and rejected with 409
    expect(response.status).toBe(409)
    expect(response.body.error?.message).toContain('expired')
  })

  it('handles multiple quotes expiring independently', async () => {
    // Set initial time
    const startTime = Date.now()
    vi.setSystemTime(startTime)

    // Create 3 quotes with different expiry times
    process.env.QUOTE_EXPIRY_MS = '30'
    ;(env as any).QUOTE_EXPIRY_MS = 30
    const { quoteId: quote1 } = await createTestQuote(app, authToken)

    process.env.QUOTE_EXPIRY_MS = '60'
    ;(env as any).QUOTE_EXPIRY_MS = 60
    const { quoteId: quote2 } = await createTestQuote(app, authToken)

    process.env.QUOTE_EXPIRY_MS = '90'
    ;(env as any).QUOTE_EXPIRY_MS = 90
    const { quoteId: quote3 } = await createTestQuote(app, authToken)

    // Advance time to 35ms - first quote should be expired, others active
    vi.setSystemTime(startTime + 35)
    
    const response1 = await attemptDeposit(app, userId, quote1)
    expect(response1.status).toBe(409)
    expect(response1.body.error?.message).toContain('expired')

    const response2 = await attemptDeposit(app, userId, quote2)
    expect(response2.status).toBe(201)
    expect(response2.body.success).toBe(true)

    // Clear the used quote2 so we can test quote3
    await quoteStore.clear()
    await depositStore.clear()

    // Recreate quotes 2 and 3 for next test
    vi.setSystemTime(startTime)
    
    process.env.QUOTE_EXPIRY_MS = '60'
    ;(env as any).QUOTE_EXPIRY_MS = 60
    const { quoteId: quote2b } = await createTestQuote(app, authToken)

    process.env.QUOTE_EXPIRY_MS = '90'
    ;(env as any).QUOTE_EXPIRY_MS = 90
    const { quoteId: quote3b } = await createTestQuote(app, authToken)

    // Advance time to 65ms - first two quotes should be expired, third active
    vi.setSystemTime(startTime + 65)

    const response2b = await attemptDeposit(app, userId, quote2b)
    expect(response2b.status).toBe(409)
    expect(response2b.body.error?.message).toContain('expired')

    const response3b = await attemptDeposit(app, userId, quote3b)
    expect(response3b.status).toBe(201)
    expect(response3b.body.success).toBe(true)

    // Clear and recreate quote3 for final test
    await quoteStore.clear()
    await depositStore.clear()

    vi.setSystemTime(startTime)
    
    process.env.QUOTE_EXPIRY_MS = '90'
    ;(env as any).QUOTE_EXPIRY_MS = 90
    const { quoteId: quote3c } = await createTestQuote(app, authToken)

    // Advance time to 95ms - all three quotes should be expired
    vi.setSystemTime(startTime + 95)

    const response3c = await attemptDeposit(app, userId, quote3c)
    expect(response3c.status).toBe(409)
    expect(response3c.body.error?.message).toContain('expired')
  })

  it('handles quote expiring during deposit request', async () => {
    // Set initial time
    const startTime = Date.now()
    vi.setSystemTime(startTime)

    // Create quote with very short expiry (5ms)
    process.env.QUOTE_EXPIRY_MS = '5'
    ;(env as any).QUOTE_EXPIRY_MS = 5
    const { quoteId } = await createTestQuote(app, authToken)

    // Advance time to exactly expiry time during request processing
    vi.setSystemTime(startTime + 5)

    // Verify request fails gracefully with expiry error
    const response = await attemptDeposit(app, userId, quoteId)
    expect(response.status).toBe(409)
    expect(response.body.error?.message).toContain('expired')
  })
})
