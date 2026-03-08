import type { Request } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { requireValidWebhookSignature } from './webhookSignature.js'
import type {
  InitiatePaymentInput,
  InitiatePaymentResult,
  ExecutePayoutInput,
  ExecutePayoutResult,
  InternalPaymentStatus,
  MapStatusInput,
  ParseWebhookResult,
  PaymentProvider,
} from './types.js'

export class StubPspProvider implements PaymentProvider {
  readonly name = 'psp'

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const externalRefSource = input.rail
    const externalRef = `pi_${input.internalRef}`
    const redirectUrl = `https://pay.example.com/${externalRef}`

    return {
      externalRefSource,
      externalRef,
      redirectUrl,
    }
  }

  async verifyPayment(_input: { externalRefSource: string; externalRef: string }): Promise<{
    status: InternalPaymentStatus
    providerStatus?: string
  }> {
    return { status: 'pending' }
  }

  async parseAndValidateWebhook(req: Request): Promise<ParseWebhookResult> {
    requireValidWebhookSignature(req)

    const body = req.body as {
      externalRefSource?: string
      externalRef?: string
      status?: string
      providerStatus?: string
    }

    if (!body.externalRefSource || !body.externalRef || !body.status) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid webhook payload')
    }

    return {
      externalRefSource: body.externalRefSource,
      externalRef: body.externalRef,
      rawStatus: body.status,
      providerStatus: body.providerStatus,
    }
  }

  mapStatus(input: MapStatusInput): InternalPaymentStatus {
    const status = input.rawStatus
    const providerStatus = input.providerStatus

    if (status === 'confirmed' || status === 'failed' || status === 'reversed') {
      return status
    }

    const normalizedProviderStatus = providerStatus?.toLowerCase() || ''

    if (
      normalizedProviderStatus.includes('reversed') ||
      normalizedProviderStatus.includes('chargeback') ||
      normalizedProviderStatus.includes('refund') ||
      normalizedProviderStatus.includes('dispute') ||
      status.toLowerCase().includes('reversed')
    ) {
      return 'reversed'
    }

    if (
      normalizedProviderStatus.includes('failed') ||
      normalizedProviderStatus.includes('declined') ||
      normalizedProviderStatus.includes('error') ||
      status.toLowerCase().includes('failed')
    ) {
      return 'failed'
    }

    return 'confirmed'
  }

  async executePayout(input: ExecutePayoutInput): Promise<ExecutePayoutResult> {
    const externalRefSource = input.rail
    const externalRef = `po_${input.internalRef}`

    return {
      externalRefSource,
      externalRef,
      status: 'confirmed',
    }
  }
}
