import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { dealStore } from '../models/dealStore.js'
import { outboxStore } from '../outbox/store.js'
import { OutboxStatus, TxType } from '../outbox/types.js'
import { listingStore } from '../models/listingStore.js'
import { ListingStatus } from '../models/listing.js'

describe('Deals API', () => {
  let app: any

  beforeEach(async () => {
    await dealStore.clear()
    app = createApp()
  })

  describe('POST /api/deals', () => {
    let approvedListingId: string

    beforeEach(async () => {
      await listingStore.clear()
      const listing = await listingStore.create({
        whistleblowerId: 'wb-001',
        address: '123 Test St',
        city: 'Lagos',
        area: 'Ikeja',
        bedrooms: 2,
        bathrooms: 2,
        annualRentNgn: 1200000,
        description: 'Test listing',
        photos: []
      })
      await listingStore.updateStatus(listing.listingId, ListingStatus.APPROVED)
      approvedListingId = listing.listingId
    })

    it('should create a new deal with valid data', async () => {
      const dealData = {
        tenantId: 'tenant-001',
        landlordId: 'landlord-001',
        listingId: approvedListingId,
        annualRentNgn: 1200000,
        depositNgn: 240000,
        termMonths: 12
      }

      const response = await request(app)
        .post('/api/deals')
        .send(dealData)
        .expect(201)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toMatchObject({
        tenantId: dealData.tenantId,
        landlordId: dealData.landlordId,
        listingId: dealData.listingId,
        annualRentNgn: dealData.annualRentNgn,
        depositNgn: dealData.depositNgn,
        financedAmountNgn: 960000,
        termMonths: dealData.termMonths,
        status: 'draft'
      })
      expect(response.body.data.dealId).toBeDefined()
      expect(response.body.data.createdAt).toBeDefined()
      expect(response.body.data.schedule).toHaveLength(12)
      
      // Check schedule structure
      const firstPayment = response.body.data.schedule[0]
      expect(firstPayment).toMatchObject({
        period: 1,
        amountNgn: 80000,
        status: 'upcoming'
      })
      expect(firstPayment.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
    })

    it('should reject deal with insufficient deposit', async () => {
      const dealData = {
        tenantId: 'tenant-001',
        landlordId: 'landlord-001',
        annualRentNgn: 1200000,
        depositNgn: 200000, // Only 16.67%, should be >= 20%
        termMonths: 12
      }

      const response = await request(app)
        .post('/api/deals')
        .send(dealData)
        .expect(400)

      expect(response.body.success).toBeUndefined()
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(response.body.error.message).toContain('Deposit must be at least 20%')
    })

    it('should reject deal with invalid term months', async () => {
      const dealData = {
        tenantId: 'tenant-001',
        landlordId: 'landlord-001',
        annualRentNgn: 1200000,
        depositNgn: 240000,
        termMonths: 9 // Invalid, should be 3, 6, or 12
      }

      const response = await request(app)
        .post('/api/deals')
        .send(dealData)
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(response.body.error.message).toContain('Term months must be one of: 3, 6, 12')
    })

    it('should reject deal with missing required fields', async () => {
      const dealData = {
        tenantId: 'tenant-001',
        // Missing landlordId, annualRentNgn, depositNgn, termMonths
      }

      const response = await request(app)
        .post('/api/deals')
        .send(dealData)
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /api/deals/:dealId', () => {
    it('should return a specific deal with schedule', async () => {
      // First create a deal
      const createResponse = await request(app)
        .post('/api/deals')
        .send({
          tenantId: 'tenant-001',
          landlordId: 'landlord-001',
          annualRentNgn: 1200000,
          depositNgn: 240000,
          termMonths: 6
        })

      const dealId = createResponse.body.data.dealId

      // Then retrieve it
      const response = await request(app)
        .get(`/api/deals/${dealId}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.dealId).toBe(dealId)
      expect(response.body.data.schedule).toHaveLength(6)
    })

    it('should return 404 for non-existent deal', async () => {
      const fakeId = '550e8400-e29b-41d4-a716-446655440999'

      const response = await request(app)
        .get(`/api/deals/${fakeId}`)
        .expect(404)

      expect(response.body.error.code).toBe('NOT_FOUND')
      expect(response.body.error.message).toContain(`Deal with ID ${fakeId} not found`)
    })
  })

  describe('GET /api/deals', () => {
    beforeEach(async () => {
      // Create some test deals
      await dealStore.create({
        tenantId: 'tenant-001',
        landlordId: 'landlord-001',
        annualRentNgn: 1200000,
        depositNgn: 240000,
        termMonths: 12
      })
      
      await dealStore.create({
        tenantId: 'tenant-002',
        landlordId: 'landlord-002',
        annualRentNgn: 2400000,
        depositNgn: 480000,
        termMonths: 6
      })
    })

    it('should return paginated list of deals', async () => {
      const response = await request(app)
        .get('/api/deals')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.deals).toHaveLength(2)
      expect(response.body.data.total).toBe(2)
      expect(response.body.data.page).toBe(1)
      expect(response.body.data.pageSize).toBe(20)
      expect(response.body.data.totalPages).toBe(1)
    })

    it('should filter deals by tenantId', async () => {
      const response = await request(app)
        .get('/api/deals?tenantId=tenant-001')
        .expect(200)

      expect(response.body.data.deals).toHaveLength(1)
      expect(response.body.data.deals[0].tenantId).toBe('tenant-001')
    })

    it('should filter deals by landlordId', async () => {
      const response = await request(app)
        .get('/api/deals?landlordId=landlord-002')
        .expect(200)

      expect(response.body.data.deals).toHaveLength(1)
      expect(response.body.data.deals[0].landlordId).toBe('landlord-002')
    })

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/deals?page=1&pageSize=1')
        .expect(200)

      expect(response.body.data.deals).toHaveLength(1)
      expect(response.body.data.page).toBe(1)
      expect(response.body.data.pageSize).toBe(1)
      expect(response.body.data.totalPages).toBe(2)
    })
  })

  describe('PATCH /api/deals/:dealId/status', () => {
    it('should update deal status', async () => {
      // Create a deal
      const createResponse = await request(app)
        .post('/api/deals')
        .send({
          tenantId: 'tenant-001',
          landlordId: 'landlord-001',
          annualRentNgn: 1200000,
          depositNgn: 240000,
          termMonths: 12
        })

      const dealId = createResponse.body.data.dealId

      // Update status
      const response = await request(app)
        .patch(`/api/deals/${dealId}/status`)
        .send({ status: 'active' })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.status).toBe('active')
    })

    it('should return 404 for non-existent deal', async () => {
      const fakeId = '550e8400-e29b-41d4-a716-446655440999'

      const response = await request(app)
        .patch(`/api/deals/${fakeId}/status`)
        .send({ status: 'active' })
        .expect(404)

      expect(response.body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('PATCH /api/deals/:dealId/schedule/:period', () => {
    it('should update schedule item status', async () => {
      // Create a deal
      const createResponse = await request(app)
        .post('/api/deals')
        .send({
          tenantId: 'tenant-001',
          landlordId: 'landlord-001',
          annualRentNgn: 1200000,
          depositNgn: 240000,
          termMonths: 3
        })

      const dealId = createResponse.body.data.dealId

      // Update first payment status
      const response = await request(app)
        .patch(`/api/deals/${dealId}/schedule/1`)
        .send({ status: 'paid' })
        .expect(200)

      expect(response.body.success).toBe(true)
      const firstPayment = response.body.data.schedule.find((item: any) => item.period === 1)
      expect(firstPayment.status).toBe('paid')
    })

    it('should return 404 for non-existent deal', async () => {
      const fakeId = '550e8400-e29b-41d4-a716-446655440999'

      const response = await request(app)
        .patch(`/api/deals/${fakeId}/schedule/1`)
        .send({ status: 'paid' })
        .expect(404)

      expect(response.body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('GET /api/deals/:dealId/progress', () => {
    let dealId: string

    beforeEach(async () => {
      await outboxStore.clear()
      // Create a fresh deal for each test
      const createRes = await request(app)
        .post('/api/deals')
        .send({
          tenantId: 'tenant-001',
          landlordId: 'landlord-001',
          annualRentNgn: 1200000,
          depositNgn: 240000,
          termMonths: 12,
        })
      dealId = createRes.body.data.dealId
    })

    it('should return zero progress when no receipts exist', async () => {
      const response = await request(app)
        .get(`/api/deals/${dealId}/progress`)
        .expect(200)

      expect(response.body.success).toBe(true)
      const data = response.body.data
      expect(data.periodsPaid).toBe(0)
      expect(data.totalPaidUsdc).toBe('0.000000')
      expect(data.remainingPeriods).toBe(12)
      expect(data.nextDueDate).toBeDefined()
      expect(data.nextDueDate).not.toBeNull()
      expect(data.lastPaymentTxId).toBeUndefined()
    })

    it('should count only SENT TENANT_REPAYMENT receipts', async () => {
      // Create a SENT receipt
      const sentItem = await outboxStore.create({
        txType: TxType.TENANT_REPAYMENT,
        source: 'stripe',
        ref: 'pi_sent_001',
        payload: { dealId, amountUsdc: '64.52', tokenAddress: 'USDC_ADDR', txType: TxType.TENANT_REPAYMENT },
      })
      await outboxStore.updateStatus(sentItem.id, OutboxStatus.SENT)

      // Create a PENDING receipt (should NOT be counted)
      await outboxStore.create({
        txType: TxType.TENANT_REPAYMENT,
        source: 'stripe',
        ref: 'pi_pending_002',
        payload: { dealId, amountUsdc: '64.52', tokenAddress: 'USDC_ADDR', txType: TxType.TENANT_REPAYMENT },
      })

      // Create a FAILED receipt (should NOT be counted)
      const failedItem = await outboxStore.create({
        txType: TxType.TENANT_REPAYMENT,
        source: 'stripe',
        ref: 'pi_failed_003',
        payload: { dealId, amountUsdc: '64.52', tokenAddress: 'USDC_ADDR', txType: TxType.TENANT_REPAYMENT },
      })
      await outboxStore.updateStatus(failedItem.id, OutboxStatus.FAILED)

      const response = await request(app)
        .get(`/api/deals/${dealId}/progress`)
        .expect(200)

      const data = response.body.data
      expect(data.periodsPaid).toBe(1)
      expect(data.totalPaidUsdc).toBe('64.520000')
      expect(data.remainingPeriods).toBe(11)
      expect(data.lastPaymentTxId).toBe(sentItem.txId)
      expect(data.lastPaymentExternalRefSource).toBe('stripe')
      expect(data.lastPaymentExternalRef).toBe('pi_sent_001')
    })

    it('should sum multiple SENT receipts and pick the latest as last payment', async () => {
      const item1 = await outboxStore.create({
        txType: TxType.TENANT_REPAYMENT,
        source: 'stripe',
        ref: 'pi_aaa',
        payload: { dealId, amountUsdc: '50.00', tokenAddress: 'USDC_ADDR', txType: TxType.TENANT_REPAYMENT },
      })
      await outboxStore.updateStatus(item1.id, OutboxStatus.SENT)

      const item2 = await outboxStore.create({
        txType: TxType.TENANT_REPAYMENT,
        source: 'stellar',
        ref: 'txhash_bbb',
        payload: { dealId, amountUsdc: '79.04', tokenAddress: 'USDC_ADDR', txType: TxType.TENANT_REPAYMENT },
      })
      await outboxStore.updateStatus(item2.id, OutboxStatus.SENT)

      const response = await request(app)
        .get(`/api/deals/${dealId}/progress`)
        .expect(200)

      const data = response.body.data
      expect(data.periodsPaid).toBe(2)
      expect(data.totalPaidUsdc).toBe('129.040000')
      expect(data.remainingPeriods).toBe(10)
      expect(data.lastPaymentExternalRefSource).toBe('stellar')
      expect(data.lastPaymentExternalRef).toBe('txhash_bbb')
    })

    it('should not count LANDLORD_PAYOUT receipts', async () => {
      const item = await outboxStore.create({
        txType: TxType.LANDLORD_PAYOUT,
        source: 'manual',
        ref: 'payout_001',
        payload: { dealId, amountUsdc: '960.00', tokenAddress: 'USDC_ADDR', txType: TxType.LANDLORD_PAYOUT },
      })
      await outboxStore.updateStatus(item.id, OutboxStatus.SENT)

      const response = await request(app)
        .get(`/api/deals/${dealId}/progress`)
        .expect(200)

      expect(response.body.data.periodsPaid).toBe(0)
      expect(response.body.data.totalPaidUsdc).toBe('0.000000')
    })

    it('should return nextDueDate as null when fully paid', async () => {
      // Create 12 SENT receipts for a 12-month deal (= fully paid)
      for (let i = 0; i < 12; i++) {
        const item = await outboxStore.create({
          txType: TxType.TENANT_REPAYMENT,
          source: 'stripe',
          ref: `pi_period_${i}`,
          payload: { dealId, amountUsdc: '80000.00', tokenAddress: 'USDC_ADDR', txType: TxType.TENANT_REPAYMENT },
        })
        await outboxStore.updateStatus(item.id, OutboxStatus.SENT)
      }

      const response = await request(app)
        .get(`/api/deals/${dealId}/progress`)
        .expect(200)

      const data = response.body.data
      expect(data.periodsPaid).toBe(12)
      expect(data.remainingPeriods).toBe(0)
      expect(data.nextDueDate).toBeNull()
    })

    it('should return 404 for non-existent deal', async () => {
      const fakeId = '550e8400-e29b-41d4-a716-446655440999'
      const response = await request(app)
        .get(`/api/deals/${fakeId}/progress`)
        .expect(404)

      expect(response.body.error.code).toBe('NOT_FOUND')
    })
  })
})
