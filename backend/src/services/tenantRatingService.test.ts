import { describe, it, expect, beforeEach, vi } from 'vitest'
import { tenantRatingService } from './tenantRatingService.js'
import { tenantRatingRepository } from '../repositories/TenantRatingRepository.js'

vi.mock('../repositories/TenantRatingRepository.js', () => ({
  tenantRatingRepository: {
    getTokenData: vi.fn(),
    findByTenantId: vi.fn(),
    getAggregate: vi.fn(),
  },
}))

describe('TenantRatingService - PII Exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should exclude PII (tenantId, landlordId) from public rating card response', async () => {
    const mockToken = 'valid-test-token-123'
    const mockTenantId = 'tenant-123'
    const mockLandlordId = 'landlord-456'

    vi.mocked(tenantRatingRepository.getTokenData).mockResolvedValue({
      id: 'token-id-1',
      token: mockToken,
      tenantId: mockTenantId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      createdAt: new Date(),
    })

    vi.mocked(tenantRatingRepository.findByTenantId).mockResolvedValue([
      {
        id: 'rating-1',
        tenantId: mockTenantId,
        landlordId: mockLandlordId,
        dealId: 'deal-1',
        paymentTimeliness: 5,
        propertyCare: 4,
        communication: 5,
        overall: 5,
        comment: 'Great tenant',
        createdAt: new Date(),
      },
      {
        id: 'rating-2',
        tenantId: mockTenantId,
        landlordId: 'landlord-789',
        dealId: 'deal-2',
        paymentTimeliness: 4,
        propertyCare: 5,
        communication: 4,
        overall: 4,
        comment: 'Reliable',
        createdAt: new Date(),
      },
    ])

    vi.mocked(tenantRatingRepository.getAggregate).mockResolvedValue({
      averagePaymentTimeliness: 4.5,
      averagePropertyCare: 4.5,
      averageCommunication: 4.5,
      averageOverall: 4.5,
      totalRatings: 2,
    })

    const result = await tenantRatingService.getCardByToken(mockToken)

    expect(result).not.toBeNull()
    expect(result?.ratings).toHaveLength(2)

    // Assert PII is excluded
    result?.ratings.forEach((rating) => {
      expect(rating).not.toHaveProperty('tenantId')
      expect(rating).not.toHaveProperty('landlordId')
      
      // Assert other fields are present
      expect(rating).toHaveProperty('id')
      expect(rating).toHaveProperty('dealId')
      expect(rating).toHaveProperty('paymentTimeliness')
      expect(rating).toHaveProperty('propertyCare')
      expect(rating).toHaveProperty('communication')
      expect(rating).toHaveProperty('overall')
      expect(rating).toHaveProperty('comment')
      expect(rating).toHaveProperty('createdAt')
    })

    // Verify aggregate is included
    expect(result?.aggregate).toEqual({
      averagePaymentTimeliness: 4.5,
      averagePropertyCare: 4.5,
      averageCommunication: 4.5,
      averageOverall: 4.5,
      totalRatings: 2,
    })
  })

  it('should return null for expired token', async () => {
    const mockToken = 'expired-test-token'

    vi.mocked(tenantRatingRepository.getTokenData).mockResolvedValue({
      id: 'token-id-1',
      token: mockToken,
      tenantId: 'tenant-123',
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago (expired)
      createdAt: new Date(),
    })

    const result = await tenantRatingService.getCardByToken(mockToken)

    expect(result).toBeNull()
    // Should not call findByTenantId or getAggregate for expired tokens
    expect(tenantRatingRepository.findByTenantId).not.toHaveBeenCalled()
    expect(tenantRatingRepository.getAggregate).not.toHaveBeenCalled()
  })

  it('should return null for invalid token', async () => {
    const mockToken = 'invalid-test-token'

    vi.mocked(tenantRatingRepository.getTokenData).mockResolvedValue(null)

    const result = await tenantRatingService.getCardByToken(mockToken)

    expect(result).toBeNull()
    expect(tenantRatingRepository.findByTenantId).not.toHaveBeenCalled()
    expect(tenantRatingRepository.getAggregate).not.toHaveBeenCalled()
  })

  it('should handle empty ratings list', async () => {
    const mockToken = 'valid-test-token-no-ratings'
    const mockTenantId = 'tenant-new'

    vi.mocked(tenantRatingRepository.getTokenData).mockResolvedValue({
      id: 'token-id-1',
      token: mockToken,
      tenantId: mockTenantId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    })

    vi.mocked(tenantRatingRepository.findByTenantId).mockResolvedValue([])
    vi.mocked(tenantRatingRepository.getAggregate).mockResolvedValue(null)

    const result = await tenantRatingService.getCardByToken(mockToken)

    expect(result).not.toBeNull()
    expect(result?.ratings).toHaveLength(0)
    expect(result?.aggregate).toBeNull()
  })
})

