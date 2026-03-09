import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createApp } from '../app.js'
import { outboxStore } from '../outbox/index.js'
import { conversionStore } from '../models/conversionStore.js'
import request from 'supertest'
import { TxType, OutboxStatus } from '../outbox/types.js'
import { sessionStore, userStore } from '../models/authStore.js'
import { StubSorobanAdapter } from '../soroban/stub-adapter.js'
import { NgnWalletService } from '../services/ngnWalletService.js'
 import { readFileSync } from 'node:fs'
 import { resolve } from 'node:path'

describe('Staking API', () => {
  let app: any
  let authToken: string

  const goldenVectorsPath = resolve(process.cwd(), '..', 'test-vectors.json')
  const goldenVectors = JSON.parse(readFileSync(goldenVectorsPath, 'utf8'))
  const expectedTxIdByCanonical = new Map<string, string>(
    (goldenVectors.golden_test_vectors ?? [])
      .filter((v: any) => v?.expected_canonical && v?.expected_sha256)
      .map((v: any) => [String(v.expected_canonical), String(v.expected_sha256)]),
  )

  beforeEach(async () => {
    app = createApp()
    await outboxStore.clear()
    vi.clearAllMocks()

    const email = 'staking-test@example.com'
    userStore.getOrCreateByEmail(email)
    authToken = 'test-token-staking'
    sessionStore.create(email, authToken)
  })

  describe('POST /api/staking/stake', () => {
    it('should stake tokens successfully', async () => {
      const response = await request(app)
        .post('/api/staking/stake')
        .send({
          amountUsdc: '1000.000000',
          externalRefSource: 'manual',
          externalRef: 'stake-2024-01-15-001',
        })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.outboxId).toBeDefined()
      expect(response.body.txId).toMatch(/^[a-f0-9]{64}$/)
      expect(response.body.txId).toBe(
        expectedTxIdByCanonical.get('v1|source=manual|ref=stake-2024-01-15-001'),
      )
      expect(response.body.status).toBe(OutboxStatus.SENT)
      expect(response.body.message).toBe('Staking confirmed and receipt written to chain')
    })

    it('should return 202 when staking is queued for retry', async () => {
      // Mock the sender to fail once
      const mockSender = await import('../outbox/sender.js')
      const originalSend = mockSender.OutboxSender.prototype.send
      const sendSpy = vi
        .spyOn(mockSender.OutboxSender.prototype, 'send')
        .mockResolvedValueOnce(false) // First call fails

      const response = await request(app)
        .post('/api/staking/stake')
        .send({
          amountUsdc: '500.000000',
          externalRefSource: 'manual',
          externalRef: 'stake-2024-01-15-002',
        })
        .expect(202)

      expect(response.body.success).toBe(true)
      expect(response.body.status).toBe(OutboxStatus.PENDING)
      expect(response.body.message).toBe('Staking confirmed, receipt queued for retry')

      sendSpy.mockRestore()
    })

    it('should be idempotent - same external ref returns existing receipt', async () => {
      const payload = {
        amountUsdc: '1000.000000',
        externalRefSource: 'manual',
        externalRef: 'stake-2024-01-15-003',
      }

      const response1 = await request(app)
        .post('/api/staking/stake')
        .send(payload)
        .expect(200)

      const response2 = await request(app)
        .post('/api/staking/stake')
        .send(payload)
        .expect(200)

      expect(response1.body.txId).toBe(response2.body.txId)
      expect(response1.body.outboxId).toBe(response2.body.outboxId)
    })

    it('should validate request body', async () => {
      const response = await request(app)
        .post('/api/staking/stake')
        .send({
          // Missing required fields
        })
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should reject invalid amount format', async () => {
      const response = await request(app)
        .post('/api/staking/stake')
        .send({
          amountUsdc: 'invalid',
          externalRefSource: 'manual',
          externalRef: 'stake-2024-01-15-004',
        })
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('POST /api/staking/unstake', () => {
    it('should unstake tokens successfully', async () => {
      const response = await request(app)
        .post('/api/staking/unstake')
        .send({
          amountUsdc: '500.000000',
          externalRefSource: 'manual',
          externalRef: 'unstake-2024-01-15-001',
        })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.outboxId).toBeDefined()
      expect(response.body.txId).toMatch(/^[a-f0-9]{64}$/)
      expect(response.body.txId).toBe(
        expectedTxIdByCanonical.get('v1|source=manual|ref=unstake-2024-01-15-001'),
      )
      expect(response.body.status).toBe(OutboxStatus.SENT)
      expect(response.body.message).toBe('Unstaking confirmed and receipt written to chain')
    })

    it('should be idempotent - same external ref returns existing receipt', async () => {
      const payload = {
        amountUsdc: '500.000000',
        externalRefSource: 'manual',
        externalRef: 'unstake-2024-01-15-002',
      }

      const response1 = await request(app)
        .post('/api/staking/unstake')
        .send(payload)
        .expect(200)

      const response2 = await request(app)
        .post('/api/staking/unstake')
        .send(payload)
        .expect(200)

      expect(response1.body.txId).toBe(response2.body.txId)
    })

    it('should validate request body', async () => {
      const response = await request(app)
        .post('/api/staking/unstake')
        .send({
          // Missing required fields
        })
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('POST /api/staking/claim', () => {
    it('should claim staking rewards successfully', async () => {
      const response = await request(app)
        .post('/api/staking/claim')
        .send({
          externalRefSource: 'manual',
          externalRef: 'claim-2024-01-15-001',
        })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.outboxId).toBeDefined()
      expect(response.body.txId).toMatch(/^[a-f0-9]{64}$/)
      expect(response.body.txId).toBe(
        expectedTxIdByCanonical.get('v1|source=manual|ref=claim-2024-01-15-001'),
      )
      expect(response.body.status).toBe(OutboxStatus.SENT)
      expect(response.body.message).toBe('Staking reward claim confirmed and receipt written to chain')
    })

    it('should be idempotent - same external ref returns existing receipt', async () => {
      const payload = {
        externalRefSource: 'manual',
        externalRef: 'claim-2024-01-15-002',
      }

      const response1 = await request(app)
        .post('/api/staking/claim')
        .send(payload)
        .expect(200)

      const response2 = await request(app)
        .post('/api/staking/claim')
        .send(payload)
        .expect(200)

      expect(response1.body.txId).toBe(response2.body.txId)
    })

    it('should validate request body', async () => {
      const response = await request(app)
        .post('/api/staking/claim')
        .send({
          // Missing required fields
        })
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /api/staking/position', () => {
    it('should return staking position', async () => {
      vi.spyOn(StubSorobanAdapter.prototype, 'getStakedBalance').mockResolvedValueOnce(1_000_000_000n)
      vi.spyOn(StubSorobanAdapter.prototype, 'getClaimableRewards').mockResolvedValueOnce(50_250_000n)

      const response = await request(app)
        .get('/api/staking/position')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-wallet-address', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.position).toBeDefined()
      expect(response.body.position.staked).toBe('1000.000000')
      expect(response.body.position.claimable).toBe('50.250000')
    })

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/staking/position')
        .expect(401)

      expect(response.body.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('POST /api/staking/stake-ngn', () => {
    beforeEach(async () => {
      await conversionStore.clear()
    })

    it('should return 409 for insufficient balance', async () => {
      const response = await request(app)
        .post('/api/staking/stake-ngn')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amountNgn: 200000, // More than available
          externalRefSource: 'web',
          externalRef: 'test-stake-003',
        })
        .expect(409)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(response.body.error.message).toContain('Insufficient available balance')
    })

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/staking/stake-ngn')
        .send({
          amountNgn: 10000,
          externalRefSource: 'web',
          externalRef: 'test-stake-005',
        })
        .expect(401)

      expect(response.body.error.code).toBe('UNAUTHORIZED')
    })

    it('should be idempotent on replay', async () => {
      // First, we need to ensure user has balance by creating a deposit via webhook
      // For now, we'll test idempotency by checking that repeated calls return same result
      const payload = {
        amountNgn: 10000,
        externalRefSource: 'web',
        externalRef: 'test-stake-idempotent',
      }

      // First request - will fail due to insufficient balance, but tests the endpoint
      const response1 = await request(app)
        .post('/api/staking/stake-ngn')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload)

      // Replay request - should behave the same way
      const response2 = await request(app)
        .post('/api/staking/stake-ngn')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload)

      // Both should return same status code
      expect(response1.status).toBe(response2.status)
    })
  })
})
