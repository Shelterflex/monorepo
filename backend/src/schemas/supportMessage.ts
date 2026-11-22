import { z } from 'zod'

export const SUPPORT_MESSAGE_STATUSES = ['new', 'in_progress', 'resolved'] as const
export type SupportMessageStatus = (typeof SUPPORT_MESSAGE_STATUSES)[number]

/** Matches an HTML tag or declaration, such as <b>, </p> or <!-- -->. Stored text is plain text. */
const HTML_TAG = /<\/?[a-zA-Z!][^>]*>/
const noHtml = (value: string) => !HTML_TAG.test(value)
const NO_HTML = 'HTML is not allowed'

/** Body of the public contact-form submission (POST /support/messages). */
export const createSupportMessageSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(255, 'Name must be at most 255 characters')
    .refine(noHtml, NO_HTML),
  email: z.string().trim().email('Invalid email address').max(254, 'Email must be at most 254 characters'),
  phone: z.string().trim().max(20, 'Phone must be at most 20 characters').optional().nullable(),
  subject: z
    .string()
    .trim()
    .min(1, 'Subject is required')
    .max(255, 'Subject must be at most 255 characters')
    .refine(noHtml, NO_HTML),
  message: z
    .string()
    .trim()
    .min(1, 'Message is required')
    .max(5000, 'Message must be at most 5000 characters')
    .refine(noHtml, NO_HTML),
})

export type CreateSupportMessageRequest = z.infer<typeof createSupportMessageSchema>

/** Query for the admin list (GET /admin/support/messages). */
export const listSupportMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
  status: z.enum(SUPPORT_MESSAGE_STATUSES).optional(),
})

export type ListSupportMessagesQuery = z.infer<typeof listSupportMessagesQuerySchema>

export interface SupportMessage {
  messageId: string
  name: string
  email: string
  phone: string | null
  subject: string
  message: string
  status: SupportMessageStatus
  ip: string | null
  userAgent: string | null
  createdAt: Date
}

export interface SupportMessagePage {
  messages: SupportMessage[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
