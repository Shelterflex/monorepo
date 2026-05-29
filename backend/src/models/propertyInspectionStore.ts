import { randomUUID } from 'node:crypto'
import { getPool, type PgPoolLike } from '../db.js'
import {
  CreateInspectionInput,
  CreateInspectorProfileInput,
  InspectionChecklistItem,
  InspectionPhoto,
  InspectionReport,
  InspectionStatus,
  InspectorProfile,
  InspectorVerificationStatus,
  PropertyInspection,
  SubmitInspectionReportInput,
} from './propertyInspection.js'

export interface PropertyInspectionStorePort {
  upsertInspectorProfile(input: CreateInspectorProfileInput): Promise<InspectorProfile>
  getInspectorProfile(userId: string): Promise<InspectorProfile | null>
  updateInspectorVerification(userId: string, status: InspectorVerificationStatus): Promise<InspectorProfile | null>
  createInspection(input: CreateInspectionInput): Promise<PropertyInspection>
  getInspection(id: string): Promise<PropertyInspection | null>
  listAvailableInspections(serviceAreas: string[]): Promise<PropertyInspection[]>
  acceptInspection(inspectionId: string, inspectorId: string): Promise<PropertyInspection>
  submitReport(input: SubmitInspectionReportInput): Promise<InspectionReport>
  reviewInspection(inspectionId: string, approved: boolean, rejectionReason?: string): Promise<InspectionReport>
  getReport(inspectionId: string): Promise<InspectionReport | null>
  getLatestApprovedByListing(listingId: string): Promise<InspectionReport | null>
  listInspectorInspections(inspectorId: string): Promise<PropertyInspection[]>
  clear(): Promise<void>
}

class InMemoryPropertyInspectionStore implements PropertyInspectionStorePort {
  private profiles = new Map<string, InspectorProfile>()
  private inspections = new Map<string, PropertyInspection>()
  private checklistItems = new Map<string, InspectionChecklistItem[]>()
  private photos = new Map<string, InspectionPhoto[]>()

  async upsertInspectorProfile(input: CreateInspectorProfileInput): Promise<InspectorProfile> {
    const now = new Date()
    const existing = this.profiles.get(input.userId)
    const profile: InspectorProfile = {
      userId: input.userId,
      verificationStatus: existing?.verificationStatus ?? InspectorVerificationStatus.PENDING,
      bio: input.bio,
      serviceAreas: input.serviceAreas,
      completedInspections: existing?.completedInspections ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.profiles.set(profile.userId, profile)
    return profile
  }

  async getInspectorProfile(userId: string): Promise<InspectorProfile | null> {
    return this.profiles.get(userId) ?? null
  }

  async updateInspectorVerification(userId: string, status: InspectorVerificationStatus): Promise<InspectorProfile | null> {
    const profile = this.profiles.get(userId)
    if (!profile) return null
    const updated = { ...profile, verificationStatus: status, updatedAt: new Date() }
    this.profiles.set(userId, updated)
    return updated
  }

  async createInspection(input: CreateInspectionInput): Promise<PropertyInspection> {
    const now = new Date()
    const inspection: PropertyInspection = {
      id: randomUUID(),
      listingId: input.listingId,
      status: InspectionStatus.PENDING,
      scheduledAt: input.scheduledAt,
      createdAt: now,
      updatedAt: now,
    }
    this.inspections.set(inspection.id, inspection)
    return inspection
  }

  async getInspection(id: string): Promise<PropertyInspection | null> {
    return this.inspections.get(id) ?? null
  }

  async listAvailableInspections(serviceAreas: string[]): Promise<PropertyInspection[]> {
    const normalized = serviceAreas.map((area) => area.toLowerCase())
    return Array.from(this.inspections.values()).filter((inspection) => {
      if (inspection.status !== InspectionStatus.PENDING) return false
      const haystack = inspection.listingId.toLowerCase()
      return normalized.length === 0 || normalized.some((area) => haystack.includes(area))
    })
  }

  async acceptInspection(inspectionId: string, inspectorId: string): Promise<PropertyInspection> {
    const inspection = this.inspections.get(inspectionId)
    if (!inspection) throw new Error('Inspection not found')
    const updated = {
      ...inspection,
      inspectorId,
      status: InspectionStatus.IN_PROGRESS,
      updatedAt: new Date(),
    }
    this.inspections.set(inspectionId, updated)
    return updated
  }

  async submitReport(input: SubmitInspectionReportInput): Promise<InspectionReport> {
    const inspection = this.inspections.get(input.inspectionId)
    if (!inspection) throw new Error('Inspection not found')
    const now = new Date()
    const updated = {
      ...inspection,
      status: InspectionStatus.SUBMITTED,
      inspectorNotes: input.inspectorNotes,
      submittedAt: now,
      updatedAt: now,
    }
    const checklistItems = input.checklistItems.map((item) => ({
      id: randomUUID(),
      inspectionId: input.inspectionId,
      ...item,
    }))
    const photos = input.photos.map((photo) => ({
      id: randomUUID(),
      inspectionId: input.inspectionId,
      url: photo.url,
      caption: photo.caption,
      takenAt: photo.takenAt ?? now,
    }))
    this.inspections.set(input.inspectionId, updated)
    this.checklistItems.set(input.inspectionId, checklistItems)
    this.photos.set(input.inspectionId, photos)
    return { inspection: updated, checklistItems, photos }
  }

  async reviewInspection(inspectionId: string, approved: boolean, rejectionReason?: string): Promise<InspectionReport> {
    const inspection = this.inspections.get(inspectionId)
    if (!inspection) throw new Error('Inspection not found')
    const now = new Date()
    const updated = {
      ...inspection,
      status: approved ? InspectionStatus.APPROVED : InspectionStatus.REJECTED,
      approvedAt: approved ? now : inspection.approvedAt,
      rejectionReason: approved ? undefined : rejectionReason,
      updatedAt: now,
    }
    this.inspections.set(inspectionId, updated)
    if (approved && updated.inspectorId) {
      const profile = this.profiles.get(updated.inspectorId)
      if (profile) {
        this.profiles.set(updated.inspectorId, {
          ...profile,
          completedInspections: profile.completedInspections + 1,
          updatedAt: now,
        })
      }
    }
    return {
      inspection: updated,
      checklistItems: this.checklistItems.get(inspectionId) ?? [],
      photos: this.photos.get(inspectionId) ?? [],
    }
  }

  async getReport(inspectionId: string): Promise<InspectionReport | null> {
    const inspection = this.inspections.get(inspectionId)
    if (!inspection) return null
    return {
      inspection,
      checklistItems: this.checklistItems.get(inspectionId) ?? [],
      photos: this.photos.get(inspectionId) ?? [],
    }
  }

  async getLatestApprovedByListing(listingId: string): Promise<InspectionReport | null> {
    const approved = Array.from(this.inspections.values())
      .filter((inspection) => inspection.listingId === listingId && inspection.status === InspectionStatus.APPROVED)
      .sort((a, b) => (b.approvedAt?.getTime() ?? 0) - (a.approvedAt?.getTime() ?? 0))[0]
    return approved ? this.getReport(approved.id) : null
  }

  async listInspectorInspections(inspectorId: string): Promise<PropertyInspection[]> {
    return Array.from(this.inspections.values()).filter((inspection) => inspection.inspectorId === inspectorId)
  }

  async clear(): Promise<void> {
    this.profiles.clear()
    this.inspections.clear()
    this.checklistItems.clear()
    this.photos.clear()
  }
}

class PostgresPropertyInspectionStore extends InMemoryPropertyInspectionStore {
  private async pool(): Promise<PgPoolLike | null> {
    return getPool()
  }

  async isAvailable(): Promise<boolean> {
    return (await this.pool()) !== null
  }
}

class HybridPropertyInspectionStore implements PropertyInspectionStorePort {
  private memory = new InMemoryPropertyInspectionStore()
  private postgres = new PostgresPropertyInspectionStore()

  private async adapter(): Promise<PropertyInspectionStorePort> {
    return (await this.postgres.isAvailable()) ? this.postgres : this.memory
  }

  async upsertInspectorProfile(input: CreateInspectorProfileInput) { return (await this.adapter()).upsertInspectorProfile(input) }
  async getInspectorProfile(userId: string) { return (await this.adapter()).getInspectorProfile(userId) }
  async updateInspectorVerification(userId: string, status: InspectorVerificationStatus) { return (await this.adapter()).updateInspectorVerification(userId, status) }
  async createInspection(input: CreateInspectionInput) { return (await this.adapter()).createInspection(input) }
  async getInspection(id: string) { return (await this.adapter()).getInspection(id) }
  async listAvailableInspections(serviceAreas: string[]) { return (await this.adapter()).listAvailableInspections(serviceAreas) }
  async acceptInspection(inspectionId: string, inspectorId: string) { return (await this.adapter()).acceptInspection(inspectionId, inspectorId) }
  async submitReport(input: SubmitInspectionReportInput) { return (await this.adapter()).submitReport(input) }
  async reviewInspection(inspectionId: string, approved: boolean, rejectionReason?: string) { return (await this.adapter()).reviewInspection(inspectionId, approved, rejectionReason) }
  async getReport(inspectionId: string) { return (await this.adapter()).getReport(inspectionId) }
  async getLatestApprovedByListing(listingId: string) { return (await this.adapter()).getLatestApprovedByListing(listingId) }
  async listInspectorInspections(inspectorId: string) { return (await this.adapter()).listInspectorInspections(inspectorId) }
  async clear() { return (await this.adapter()).clear() }
}

export const propertyInspectionStore = new HybridPropertyInspectionStore()
export { InMemoryPropertyInspectionStore }
