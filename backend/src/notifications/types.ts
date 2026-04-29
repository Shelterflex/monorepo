export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  PUSH = 'push',
}

export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  DEAD_LETTER = 'dead_letter',
}

export interface NotificationJobPayload extends Record<string, unknown> {
  channel: NotificationChannel
  recipient: string // email for EMAIL, phone for SMS, userId for PUSH
  subject?: string
  body: string
  html?: string
  templateId?: string
  metadata?: Record<string, unknown>
}

export interface NotificationProvider {
  channel: NotificationChannel
  send(payload: NotificationJobPayload): Promise<void>
}

export interface NotificationDeliveryResult {
  success: boolean
  error?: string
  provider?: string
}
