import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { listingStore } from '../models/listingStore.js'
import {
  InspectionReport,
  InspectionStatus,
  InspectionSummary,
  InspectorEarnings,
  InspectorVerificationStatus,
  SubmitInspectionReportInput,
} from '../models/propertyInspection.js'
import {
  propertyInspectionStore,
  type PropertyInspectionStorePort,
} from '../models/propertyInspectionStore.js'

export const INSPECTION_PAYOUT_NGN = 15000

export class PropertyInspectionService {
  constructor(private readonly store: PropertyInspectionStorePort = propertyInspectionStore) {}

  async apply(userId: string, input: { bio?: string; serviceAreas: string[] }) {
    return this.store.upsertInspectorProfile({
      userId,
      bio: input.bio,
      serviceAreas: input.serviceAreas,
    })
  }

  async listJobs(userId: string) {
    const profile = await this.requireProfile(userId)
    return this.store.listAvailableInspections(profile.serviceAreas)
  }

  async acceptJob(userId: string, inspectionId: string) {
    const profile = await this.requireProfile(userId)
    if (profile.verificationStatus !== InspectorVerificationStatus.VERIFIED) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Inspector must be verified to accept jobs')
    }

    const inspection = await this.requireInspection(inspectionId)
    if (inspection.status !== InspectionStatus.PENDING) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'Only pending inspections can be accepted')
    }

    return this.store.acceptInspection(inspectionId, userId)
  }

  async submitReport(input: SubmitInspectionReportInput): Promise<InspectionReport> {
    const inspection = await this.requireInspection(input.inspectionId)
    if (inspection.status !== InspectionStatus.IN_PROGRESS) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'Only in-progress inspections can be submitted')
    }
    if (inspection.inspectorId !== input.inspectorId) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Inspector can only report on accepted jobs')
    }
    if (input.checklistItems.length === 0 || input.photos.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Report requires checklist items and photos')
    }
    return this.store.submitReport(input)
  }

  async reviewInspection(inspectionId: string, approved: boolean, rejectionReason?: string) {
    const inspection = await this.requireInspection(inspectionId)
    if (inspection.status !== InspectionStatus.SUBMITTED) {
      throw new AppError(ErrorCode.CONFLICT, 409, 'Only submitted inspections can be reviewed')
    }

    const report = await this.store.reviewInspection(inspectionId, approved, rejectionReason)
    if (approved) {
      await listingStore.markVerifiedInspection(report.inspection.listingId)
    }
    return report
  }

  async getEarnings(userId: string): Promise<InspectorEarnings> {
    const inspections = await this.store.listInspectorInspections(userId)
    const completed = inspections.filter((inspection) => inspection.status === InspectionStatus.APPROVED)
    return {
      completedInspections: completed.length,
      totalEarningsNgn: completed.length * INSPECTION_PAYOUT_NGN,
      inspections: inspections.map((inspection) => ({
        inspectionId: inspection.id,
        listingId: inspection.listingId,
        approvedAt: inspection.approvedAt,
        payoutNgn: inspection.status === InspectionStatus.APPROVED ? INSPECTION_PAYOUT_NGN : 0,
        status: inspection.status,
      })),
    }
  }

  async getApprovedSummary(listingId: string): Promise<InspectionSummary> {
    const report = await this.store.getLatestApprovedByListing(listingId)
    if (!report) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Approved inspection summary not found')
    }

    const categories: InspectionSummary['categories'] = {}
    for (const item of report.checklistItems) {
      categories[item.category] ??= { pass: 0, fail: 0, na: 0 }
      categories[item.category][item.result] += 1
    }

    return {
      inspectionId: report.inspection.id,
      listingId,
      approvedAt: report.inspection.approvedAt ?? report.inspection.updatedAt,
      inspectorNotes: report.inspection.inspectorNotes,
      categories,
      photos: report.photos.map((photo) => ({ url: photo.url, caption: photo.caption })),
    }
  }

  private async requireProfile(userId: string) {
    const profile = await this.store.getInspectorProfile(userId)
    if (!profile) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, 'Inspector profile required')
    }
    return profile
  }

  private async requireInspection(inspectionId: string) {
    const inspection = await this.store.getInspection(inspectionId)
    if (!inspection) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Inspection not found')
    }
    return inspection
  }
}

export const propertyInspectionService = new PropertyInspectionService()
