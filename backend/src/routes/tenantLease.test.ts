/**
 * Tenant lease endpoints tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createTenantLeaseRouter } from './tenantLease.js'
import { dealStore } from '../models/dealStore.js'
import { listingStore } from '../models/listingStore.js'
import { userStore } from '../models/authStore.js'
import { DealStatus } from '../models/deal.js'
import { ListingStatus } from '../models/listing.js'
import { generateId } from '../utils/tokens.js'
import { createApp } from '../app.js'

describe('tenantLease routes', () => {
  let app: express.Express
  let tenantUserId: string
  let landlordUserId: string
  let adminUserId: string
  let tenantToken: string
  let landlordToken: string
  let adminToken: string
  let listingId: string
  let dealId: string
  let otherDealId: string

  beforeAll(async () => {
    // Create test users
    tenantUserId = generateId()
    landlordUserId = generateId()
    adminUserId = generateId()

    // Create mock user records
    await (userStore as any).fallbackCache.set(tenantUserId, {
      id: tenantUserId,
      email: 'tenant@test.com',
      name: 'Test Tenant',
      role: 'tenant',
      createdAt: new Date(),
    })
    await (userStore as any).fallbackCache.set(landlordUserId, {
      id: landlordUserId,
      email: 'landlord@test.com',
      name: 'Test Landlord',
      role: 'landlord',
      createdAt: new Date(),
    })
    await (userStore as any).fallbackCache.set(adminUserId, {
      id: adminUserId,
      email: 'admin@test.com',
      name: 'Test Admin',
      role: 'admin',
      createdAt: new Date(),
    })

    // Create mock tokens (simplified for testing)
    tenantToken = `mock-token-${tenantUserId}`
    landlordToken = `mock-token-${landlordUserId}`
    adminToken = `mock-token-${adminUserId}`

    // Create a test listing
    const listing = await listingStore.create({
      whistleblowerId: landlordUserId,
      address: '123 Test Street',
      city: 'Lagos',
      area: 'Lekki',
      bedrooms: 2,
      bathrooms: 1,
      annualRentNgn: 600000,
      outrightPriceNgn: 5000000,
      installmentBasePriceNgn: 600000,
      description: 'Test property',
      photos: [],
    })
    listingId = listing.listingId
    await listingStore.updateStatus(listingId, ListingStatus.APPROVED)

    // Create test deals
    const deal1 = await dealStore.create({
      tenantId: tenantUserId,
      landlordId: landlordUserId,
      listingId,
      annualRentNgn: 600000,
      depositNgn: 120000,
      termMonths: 12,
    })
    dealId = deal1.dealId
    await dealStore.updateStatus(dealId, DealStatus.ACTIVE)

    const deal2 = await dealStore.create({
      tenantId: tenantUserId,
      landlordId: landlordUserId,
      listingId,
      annualRentNgn: 600000,
      depositNgn: 120000,
      termMonths: 6,
    })
    otherDealId = deal2.dealId
    await dealStore.updateStatus(otherDealId, DealStatus.DRAFT)

    app = createApp()
  })

  afterAll(async () => {
    await dealStore.clear()
    await listingStore.clear()
    userStore.clear()
  })

  beforeEach(async () => {
    // Reset deal statuses before each test
    await dealStore.updateStatus(dealId, DealStatus.ACTIVE)
    await dealStore.updateStatus(otherDealId, DealStatus.DRAFT)
  })

  describe('GET /tenant/lease/current', () => {
    it('should return current lease for authenticated tenant', async () => {
      const response = await request(app)
        .get('/api/tenant/lease/current')
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toBeTruthy()
      expect(response.body.data.dealId).toBe(dealId)
      expect(response.body.data.property).toBe('123 Test Street')
      expect(response.body.data.progress).toBeGreaterThanOrEqual(0)
      expect(response.body.data.progress).toBeLessThanOrEqual(100)
    })

    it('should return null when tenant has no active lease', async () => {
      // Deactivate all deals
      await dealStore.updateStatus(dealId, DealStatus.COMPLETED)
      await dealStore.updateStatus(otherDealId, DealStatus.COMPLETED)

      const response = await request(app)
        .get('/api/tenant/lease/current')
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toBeNull()
    })

    it('should choose the most recent active deal when multiple exist', async () => {
      // Activate both deals
      await dealStore.updateStatus(otherDealId, DealStatus.ACTIVE)

      const response = await request(app)
        .get('/api/tenant/lease/current')
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toBeTruthy()
      // Should return the more recently created deal (otherDealId)
      expect(response.body.data.dealId).toBe(otherDealId)
    })

    it('should return 401 for unauthenticated requests', async () => {
      await request(app)
        .get('/api/tenant/lease/current')
        .expect(401)
    })

    it('should return 403 for non-tenant roles', async () => {
      await request(app)
        .get('/api/tenant/lease/current')
        .set('Authorization', `Bearer ${landlordToken}`)
        .expect(403)

      await request(app)
        .get('/api/tenant/lease/current')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403)
    })
  })

  describe('GET /tenant/deals/:dealId/lease', () => {
    it('should return lease details for tenant\'s own deal', async () => {
      const response = await request(app)
        .get(`/api/tenant/deals/${dealId}/lease`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data.dealId).toBe(dealId)
      expect(response.body.data.property.title).toBe('123 Test Street')
      expect(response.body.data.lease.monthlyPayment).toBeGreaterThan(0)
      expect(response.body.data.landlord.name).toBe('Test Landlord')
      expect(response.body.data.paymentProgress.totalPayments).toBeGreaterThan(0)
    })

    it('should return 404 for non-existent deal', async () => {
      const response = await request(app)
        .get('/api/tenant/deals/nonexistent-id/lease')
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(404)

      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('should return 404 for deal belonging to another tenant', async () => {
      // Create a deal for a different tenant
      const otherTenantId = generateId()
      const otherUser = {
        id: otherTenantId,
        email: 'other@test.com',
        name: 'Other Tenant',
        role: 'tenant',
        createdAt: new Date(),
      }
      await (userStore as any).fallbackCache.set(otherTenantId, otherUser)

      const otherDeal = await dealStore.create({
        tenantId: otherTenantId,
        landlordId: landlordUserId,
        listingId,
        annualRentNgn: 600000,
        depositNgn: 120000,
        termMonths: 12,
      })
      await dealStore.updateStatus(otherDeal.dealId, DealStatus.ACTIVE)

      const response = await request(app)
        .get(`/api/tenant/deals/${otherDeal.dealId}/lease`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(404)

      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('should return 401 for unauthenticated requests', async () => {
      await request(app)
        .get(`/api/tenant/deals/${dealId}/lease`)
        .expect(401)
    })

    it('should return 403 for non-tenant roles', async () => {
      await request(app)
        .get(`/api/tenant/deals/${dealId}/lease`)
        .set('Authorization', `Bearer ${landlordToken}`)
        .expect(403)

      await request(app)
        .get(`/api/tenant/deals/${dealId}/lease`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403)
    })

    it('should return 400 for invalid dealId format', async () => {
      const response = await request(app)
        .get('/api/tenant/deals/invalid-uuid/lease')
        .set('Authorization', `Bearer ${tenantToken}`)
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })
  })
})
