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
  private readonly rail: string

  constructor(rail: string = 'psp') {
    this.rail = rail
  }

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
    // Use provider-specific signature validation with the rail
    requireValidWebhookSignature(req, this.rail as any)

    const body = req.body as {
      externalRefSource?: string
      externalRef?: string
      status?: string
      providerStatus?: string
      /** Optional — tests can set to simulate distinct PSP deliveries for the same ref. */
      providerEventId?: string
    }

    if (!body.externalRefSource || !body.externalRef || !body.status) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid webhook payload')
    }

    const providerEventId =
      body.providerEventId != null && String(body.providerEventId).trim() !== ''
        ? String(body.providerEventId)
        : `stub:${body.externalRef}:${body.status}`

    return {
      externalRefSource: body.externalRefSource,
      externalRef: body.externalRef,
      rawStatus: body.status,
      providerStatus: body.providerStatus,
      providerEventId,
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

  async resolveBankAccount(
    accountNumber: string,
    _bankCode: string,
  ): Promise<{ accountName: string; accountNumber: string }> {
    if (!accountNumber || accountNumber.length < 10 || accountNumber === '0000000000') {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'Could not resolve bank account details',
      )
    }

    return {
      accountNumber,
      accountName: 'TEST VERIFIED ACCOUNT',
    }
  }
}
