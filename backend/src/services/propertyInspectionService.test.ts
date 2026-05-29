import { beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../errors/AppError.js'
import { listingStore } from '../models/listingStore.js'
import { ListingStatus } from '../models/listing.js'
import {
  InspectionResult,
  InspectionStatus,
  InspectorVerificationStatus,
} from '../models/propertyInspection.js'
import { InMemoryPropertyInspectionStore } from '../models/propertyInspectionStore.js'
import { PropertyInspectionService } from './propertyInspectionService.js'

describe('PropertyInspectionService', () => {
  let store: InMemoryPropertyInspectionStore
  let service: PropertyInspectionService

  beforeEach(async () => {
    store = new InMemoryPropertyInspectionStore()
    service = new PropertyInspectionService(store)
    await listingStore.clear()
  })

  it('blocks unverified inspectors from accepting jobs', async () => {
    await service.apply('inspector-1', { serviceAreas: ['lekki'] })
    const inspection = await store.createInspection({
      listingId: 'lekki-listing',
      scheduledAt: new Date(),
    })

    await expect(service.acceptJob('inspector-1', inspection.id)).rejects.toThrow(AppError)
  })

  it('enforces pending to in_progress to submitted to approved transitions', async () => {
    await service.apply('inspector-1', { serviceAreas: ['lekki'] })
    await store.updateInspectorVerification('inspector-1', InspectorVerificationStatus.VERIFIED)
    const inspection = await store.createInspection({
      listingId: 'lekki-listing',
      scheduledAt: new Date(),
    })

    const accepted = await service.acceptJob('inspector-1', inspection.id)
    expect(accepted.status).toBe(InspectionStatus.IN_PROGRESS)

    const submitted = await service.submitReport({
      inspectorId: 'inspector-1',
      inspectionId: inspection.id,
      checklistItems: [
        {
          category: 'safety',
          item: 'Smoke detector present',
          result: InspectionResult.PASS,
        },
      ],
      photos: [{ url: 'https://example.com/photo.jpg' }],
      inspectorNotes: 'Safe and clean',
    })
    expect(submitted.inspection.status).toBe(InspectionStatus.SUBMITTED)

    const reviewed = await service.reviewInspection(inspection.id, true)
    expect(reviewed.inspection.status).toBe(InspectionStatus.APPROVED)
  })

  it('requires reports to include checklist items and photos', async () => {
    await service.apply('inspector-1', { serviceAreas: ['yaba'] })
    await store.updateInspectorVerification('inspector-1', InspectorVerificationStatus.VERIFIED)
    const inspection = await store.createInspection({
      listingId: 'yaba-listing',
      scheduledAt: new Date(),
    })
    await service.acceptJob('inspector-1', inspection.id)

    await expect(
      service.submitReport({
        inspectorId: 'inspector-1',
        inspectionId: inspection.id,
        checklistItems: [],
        photos: [],
      }),
    ).rejects.toThrow(AppError)
  })

  it('updates the listing trust indicator when approved', async () => {
    const listing = await listingStore.create({
      whistleblowerId: 'wb-1',
      address: '12 Lekki Phase 1',
      city: 'Lagos',
      area: 'Lekki',
      bedrooms: 2,
      bathrooms: 2,
      annualRentNgn: 2000000,
      photos: ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'],
    })
    await listingStore.moderate(listing.listingId, ListingStatus.APPROVED, 'admin')
    await service.apply('inspector-1', { serviceAreas: ['lekki'] })
    await store.updateInspectorVerification('inspector-1', InspectorVerificationStatus.VERIFIED)
    const inspection = await store.createInspection({
      listingId: listing.listingId,
      scheduledAt: new Date(),
    })
    await service.acceptJob('inspector-1', inspection.id)
    await service.submitReport({
      inspectorId: 'inspector-1',
      inspectionId: inspection.id,
      checklistItems: [{ category: 'structural', item: 'Walls', result: InspectionResult.PASS }],
      photos: [{ url: 'https://example.com/photo.jpg' }],
    })

    await service.reviewInspection(inspection.id, true)

    const updated = await listingStore.getById(listing.listingId)
    expect(updated?.hasVerifiedInspection).toBe(true)
    expect(updated?.trustScore).toBeGreaterThan(0)
  })
})
