export enum WebhookProcessingStatus {
  PENDING = 'pending',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

export enum ReplayStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export enum ActorType {
  ADMIN = 'admin',
  OPERATOR = 'operator',
  SYSTEM = 'system',
}

export interface WebhookEvent {
  id: string
  provider: string
  eventType: string
  externalId: string
  payload: Record<string, unknown>
  headers?: Record<string, string>
  receivedAt: Date
  processedAt?: Date
  processingStatus: WebhookProcessingStatus
  processingError?: string
}

export interface WebhookReplayAttempt {
  id: string
  webhookEventId: string
  actorUserId: string
  actorType: ActorType
  reason: string
  dryRun: boolean
  status: ReplayStatus
  outcome?: Record<string, unknown>
  errorMessage?: string
  startedAt: Date
  completedAt?: Date
}

export interface ReplayRequest {
  provider?: string
  eventType?: string
  startTime?: Date
  endTime?: Date
  webhookEventId?: string
  dryRun: boolean
  reason: string
}

export interface ReplayPreview {
  totalEvents: number
  events: WebhookEvent[]
}
