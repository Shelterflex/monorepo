import type { Request } from 'express'

export type InternalPaymentStatus = 'pending' | 'confirmed' | 'failed' | 'reversed'

export interface InitiatePaymentInput {
  amountNgn: number
  userId: string
  internalRef: string
  rail: string
  customerMeta?: {
    name?: string
    phone?: string
  }
}

export interface InitiatePaymentResult {
  externalRefSource: string
  externalRef: string
  redirectUrl?: string
  bankDetails?: Record<string, string>
}

export interface ParseWebhookResult {
  externalRefSource: string
  externalRef: string
  rawStatus: string
  providerStatus?: string
}

export interface MapStatusInput {
  rawStatus: string
  providerStatus?: string
}

export interface ExecutePayoutInput {
  amountNgn: number
  userId: string
  internalRef: string
  bankAccount: {
    accountNumber: string
    accountName: string
    bankName: string
  }
  rail: string
}

export interface ExecutePayoutResult {
  externalRefSource: string
  externalRef: string
  status: 'confirmed' | 'failed'
  providerStatus?: string
}

export interface PaymentProvider {
  readonly name: string

  initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult>

  verifyPayment(_input: { externalRefSource: string; externalRef: string }): Promise<{
    status: InternalPaymentStatus
    providerStatus?: string
  }>

  parseAndValidateWebhook(req: Request): Promise<ParseWebhookResult>

  mapStatus(input: MapStatusInput): InternalPaymentStatus

  executePayout?(input: ExecutePayoutInput): Promise<ExecutePayoutResult>
}
