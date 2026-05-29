export enum InspectionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum InspectorVerificationStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  SUSPENDED = 'suspended',
}

export enum InspectionResult {
  PASS = 'pass',
  FAIL = 'fail',
  NA = 'na',
}

export type InspectionCategory =
  | 'structural'
  | 'plumbing'
  | 'electrical'
  | 'safety'
  | 'exterior'

export interface InspectorProfile {
  userId: string
  verificationStatus: InspectorVerificationStatus
  bio?: string
  serviceAreas: string[]
  completedInspections: number
  createdAt: Date
  updatedAt: Date
}

export interface PropertyInspection {
  id: string
  listingId: string
  inspectorId?: string
  status: InspectionStatus
  scheduledAt: Date
  submittedAt?: Date
  approvedAt?: Date
  inspectorNotes?: string
  rejectionReason?: string
  createdAt: Date
  updatedAt: Date
}

export interface InspectionChecklistItem {
  id: string
  inspectionId: string
  category: InspectionCategory
  item: string
  result: InspectionResult
  notes?: string
}

export interface InspectionPhoto {
  id: string
  inspectionId: string
  url: string
  caption?: string
  takenAt: Date
}

export interface InspectionReport {
  inspection: PropertyInspection
  checklistItems: InspectionChecklistItem[]
  photos: InspectionPhoto[]
}

export interface InspectionSummary {
  inspectionId: string
  listingId: string
  approvedAt: Date
  inspectorNotes?: string
  categories: Record<string, { pass: number; fail: number; na: number }>
  photos: Array<{ url: string; caption?: string }>
}

export interface InspectorEarnings {
  completedInspections: number
  totalEarningsNgn: number
  inspections: Array<{
    inspectionId: string
    listingId: string
    approvedAt?: Date
    payoutNgn: number
    status: InspectionStatus
  }>
}

export interface CreateInspectorProfileInput {
  userId: string
  bio?: string
  serviceAreas: string[]
}

export interface CreateInspectionInput {
  listingId: string
  scheduledAt: Date
}

export interface SubmitInspectionReportInput {
  inspectorId: string
  inspectionId: string
  checklistItems: Array<{
    category: InspectionCategory
    item: string
    result: InspectionResult
    notes?: string
  }>
  photos: Array<{
    url: string
    caption?: string
    takenAt?: Date
  }>
  inspectorNotes?: string
}
