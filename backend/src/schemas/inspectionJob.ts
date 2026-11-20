import { z } from 'zod'

export const inspectionJobSchema = z.object({
  id: z.string().uuid(),
  listingId: z.string().uuid(),
  inspectorId: z.string().nullable(),
  status: z.enum(['available', 'claimed', 'in_progress', 'submitted', 'approved', 'rejected']),
  offeredFeeNgn: z.number().positive(),
  claimDeadline: z.date().nullable(),
  submittedAt: z.date().nullable(),
  approvedAt: z.date().nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type InspectionJob = z.infer<typeof inspectionJobSchema>

export const inspectionReportSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  overallGrade: z.enum(['A', 'B', 'C', 'D']),
  roomChecklist: z.record(z.any()).optional(),
  photoKeys: z.array(z.string()).min(3),
  notes: z.string().min(20),
  submittedAt: z.date(),
})

export type InspectionReport = z.infer<typeof inspectionReportSchema>

export const submitInspectionReportSchema = z.object({
  overallGrade: z.enum(['A', 'B', 'C', 'D']),
  roomChecklist: z.record(z.any()).optional(),
  photoKeys: z.array(z.string()).min(3, 'At least 3 photos required'),
  notes: z.string().min(20, 'Notes must be at least 20 characters'),
})

export type SubmitInspectionReportRequest = z.infer<typeof submitInspectionReportSchema>

export const createInspectionJobSchema = z.object({
  listingId: z.string().uuid(),
  offeredFeeNgn: z.number().positive(),
})

export type CreateInspectionJobRequest = z.infer<typeof createInspectionJobSchema>

export const listInspectionJobsSchema = z.object({
  status: z.enum(['available', 'claimed', 'in_progress', 'submitted', 'approved', 'rejected']).optional(),
  area: z.string().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().default(20).max(100),
})

export type ListInspectionJobsRequest = z.infer<typeof listInspectionJobsSchema>

export const rejectInspectionJobSchema = z.object({
  reason: z.string().min(10),
})

export type RejectInspectionJobRequest = z.infer<typeof rejectInspectionJobSchema>
