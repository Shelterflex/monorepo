import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPaymentsRouter } from './payments.js'
import type { SorobanAdapter } from '../soroban/adapter.js'
import { outboxStore } from '../outbox/store.js'
import { dealStore } from '../models/dealStore.js'
import { userStore } from '../models/authStore.js'
import { logger } from '../utils/logger.js'

vi.mock('../services/webhookDeliveryService.js', () => ({
  enqueueDelivery: vi.fn().mockResolvedValue(undefined),
}))

const TENANT_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
const LANDLORD_ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'

function setup() {
  const createRentPaymentReceipt = vi.fn().mockResolvedValue('rent-receipt-tx')
  const adapter = {
    recordReceipt: vi.fn().mockResolvedValue(undefined),
    createRentPaymentReceipt,
  } as unknown as SorobanAdapter

  const app = express()
  app.use(express.json())
  app.use('/api/payments', createPaymentsRouter(adapter))

  return { app, createRentPaymentReceipt }
}

function mockDealAndWallets() {
  vi.spyOn(dealStore, 'findById').mockResolvedValue({
    dealId: 'deal-001',
    tenantId: 'tenant-001',
    landlordId: 'landlord-001',
    schedule: [],
  } as never)
  vi.spyOn(userStore, 'getById').mockImplementation(async (userId) => ({
    id: userId,
    email: `${userId}@example.com`,
    walletAddress: userId === 'tenant-001' ? TENANT_ADDRESS.toLowerCase() : LANDLORD_ADDRESS.toLowerCase(),
  } as never))
}

const payload = {
  dealId: 'deal-001',
  txType: 'tenant_repayment',
  amountUsdc: '100.50',
  tokenAddress: 'USDC_TOKEN_ADDRESS_TESTNET',
  externalRefSource: 'manual',
  externalRef: 'rent-receipt-test',
}

describe('POST /api/payments/confirm rent payment receipt', () => {
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    await outboxStore.clear()
    mockDealAndWallets()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a deal-scoped receipt with the tenant and landlord wallet addresses', async () => {
    const { app, createRentPaymentReceipt } = setup()

    const response = await request(app).post('/api/payments/confirm').send(payload)

    expect([200, 202]).toContain(response.status)
    expect(response.body.success).toBe(true)
    expect(createRentPaymentReceipt).toHaveBeenCalledWith(
      'deal-001',
      100_500_000n,
      TENANT_ADDRESS,
      LANDLORD_ADDRESS,
      expect.any(Number),
    )
  })

  it('logs receipt creation failures without failing the confirmed payment', async () => {
    const { app, createRentPaymentReceipt } = setup()
    createRentPaymentReceipt.mockRejectedValueOnce(new Error('rent contract unavailable'))
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined)

    const response = await request(app)
      .post('/api/payments/confirm')
      .send({ ...payload, externalRef: 'rent-receipt-failure-test' })

    expect([200, 202]).toContain(response.status)
    expect(response.body.success).toBe(true)
    expect(logError).toHaveBeenCalledWith(
      'Failed to create rent payment receipt',
      expect.objectContaining({
        dealId: 'deal-001',
        error: 'rent contract unavailable',
      }),
    )
  })
})
