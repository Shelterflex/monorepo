import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { dealStore } from '../models/dealStore.js'

describe('Deals API', () => {
  let app: any

  beforeEach(async () => {
    await dealStore.clear()
    app = createApp()
  })

  describe('POST /api/deals', () => {
    it('should create a new deal with valid data', async () => {
      const dealData = {
        tenantId: 'tenant-001',
        landlordId: 'landlord-001',
        listingId: '550e8400-e29b-41d4-a716-446655440001',
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
})
