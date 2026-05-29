import { z } from 'zod'
import { InspectionResult } from '../models/propertyInspection.js'

export const inspectorApplicationSchema = z.object({
  bio: z.string().max(1000).optional(),
  serviceAreas: z.array(z.string().min(1)).min(1, 'At least one service area is required'),
})

export const inspectionReportSchema = z.object({
  inspectorNotes: z.string().max(4000).optional(),
  checklistItems: z.array(z.object({
    category: z.enum(['structural', 'plumbing', 'electrical', 'safety', 'exterior']),
    item: z.string().min(1),
    result: z.nativeEnum(InspectionResult),
    notes: z.string().max(1000).optional(),
  })).min(1, 'At least one checklist item is required'),
  photos: z.array(z.object({
    url: z.string().url(),
    caption: z.string().max(500).optional(),
    takenAt: z.coerce.date().optional(),
  })).min(1, 'At least one photo is required').max(10, 'Maximum 10 photos allowed'),
})

export const inspectionReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  rejectionReason: z.string().min(1).optional(),
})
