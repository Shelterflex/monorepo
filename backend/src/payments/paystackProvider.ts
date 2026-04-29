/**
 * PaystackProvider — production adapter for the Paystack payment rail.
 *
 * API reference: https://paystack.com/docs/api/
 *
 * Credential env vars (set via PSP_PROVIDER_PAYSTACK=paystack):
 *   PAYSTACK_SECRET      — sk_live_... or sk_test_...
 *   PAYSTACK_BASE_URL    — override for tests/sandbox (default: https://api.paystack.co)
 *
 * Webhook env var:
 *   PAYSTACK_SECRET      — shared with the signature validator in webhookSignature.ts
 */

import { createHash } from 'node:crypto'
import type { Request } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { requireValidWebhookSignature } from './webhookSignature.js'
import { getRotatingAPIKey } from '../services/rotatingSecretProvider.js'
import type {
  ExecutePayoutInput,
  ExecutePayoutResult,
  InitiatePaymentInput,
  InitiatePaymentResult,
  InternalPaymentStatus,
  MapStatusInput,
  ParseWebhookResult,
  PaymentProvider,
} from './types.js'

const PAYSTACK_BASE_URL = () =>
  process.env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co'

function getSecret(): string {
  const rotating = getRotatingAPIKey('paystack')
  if (rotating) return rotating

  const s = process.env.PAYSTACK_SECRET
  if (!s) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      500,
      'PAYSTACK_SECRET is not configured',
    )
  }
  return s
}

async function paystackPost<T>(path: string, body: unknown): Promise<T> {
  const secret = getSecret()
  const res = await fetch(`${PAYSTACK_BASE_URL()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json()) as { status: boolean; message: string; data: T }

  if (!res.ok || !json.status) {
    throw new AppError(
      ErrorCode.PAYMENT_PROVIDER_ERROR,
      502,
      `Paystack error: ${json.message ?? res.statusText}`,
    )
  }

  return json.data
}

async function paystackGet<T>(path: string): Promise<T> {
  const secret = getSecret()
  const res = await fetch(`${PAYSTACK_BASE_URL()}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  })

  const json = (await res.json()) as { status: boolean; message: string; data: T }

  if (!res.ok || !json.status) {
    throw new AppError(
      ErrorCode.PAYMENT_PROVIDER_ERROR,
      502,
      `Paystack error: ${json.message ?? res.statusText}`,
    )
  }

  return json.data
}

// ---------------------------------------------------------------------------
// Paystack-specific status → internal status mapping
//
// Paystack webhook event names:
//   charge.success          → confirmed
//   charge.failed           → failed
//   charge.dispute.create   → reversed (chargeback opened)
//   charge.dispute.resolve  → confirmed (dispute resolved in merchant favour)
//   transfer.reversed       → reversed (payout returned)
//
// Paystack transaction status strings (from verify API):
//   success  → confirmed
//   failed   → failed
//   abandoned / pending / ongoing → pending (no final status yet)
// ---------------------------------------------------------------------------

const PAYSTACK_EVENT_MAP: Record<string, InternalPaymentStatus> = {
  'charge.success': 'confirmed',
  'charge.failed': 'failed',
  'charge.dispute.create': 'reversed',
  'charge.dispute.resolve': 'confirmed',
  'transfer.reversed': 'reversed',
  'transfer.failed': 'failed',
  'transfer.success': 'confirmed',
}

const PAYSTACK_TX_STATUS_MAP: Record<string, InternalPaymentStatus> = {
  success: 'confirmed',
  failed: 'failed',
  abandoned: 'failed',
  reversed: 'reversed',
}

// ---------------------------------------------------------------------------

export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack'

  // ---- Payment initiation -------------------------------------------------

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    /**
     * Paystack /transaction/initialize
     * Amounts are in kobo (1 NGN = 100 kobo).
     */
    const amountKobo = Math.round(input.amountNgn * 100)

    // Paystack requires an email; fall back to a deterministic placeholder
    // derived from the userId so that test/staging flows don't break.
    const email =
      input.customerMeta?.email ?? `${input.userId}@quipay.internal`

    const data = await paystackPost<{
      authorization_url: string
      access_code: string
      reference: string
    }>('/transaction/initialize', {
      amount: amountKobo,
      email,
      reference: input.internalRef,
      callback_url: process.env.PAYSTACK_CALLBACK_URL,
      metadata: {
        internalRef: input.internalRef,
        userId: input.userId,
        rail: input.rail,
        customerName: input.customerMeta?.name,
        customerPhone: input.customerMeta?.phone,
      },
    })

    return {
      externalRefSource: 'paystack',
      externalRef: data.reference,
      redirectUrl: data.authorization_url,
    }
  }

  // ---- Payment verification -----------------------------------------------

  async verifyPayment(input: {
    externalRefSource: string
    externalRef: string
  }): Promise<{ status: InternalPaymentStatus; providerStatus?: string }> {
    const data = await paystackGet<{
      status: string
      gateway_response?: string
    }>(`/transaction/verify/${encodeURIComponent(input.externalRef)}`)

    const providerStatus = data.status
    const mapped = PAYSTACK_TX_STATUS_MAP[providerStatus] ?? 'pending'

    return { status: mapped, providerStatus }
  }

  // ---- Webhook parsing & validation ---------------------------------------

  async parseAndValidateWebhook(req: Request): Promise<ParseWebhookResult> {
    // Delegate HMAC-SHA512 validation to the shared utility
    requireValidWebhookSignature(req, 'paystack')

    const body = req.body as {
      id?: string | number
      event?: string
      data?: {
        reference?: string
        tx_ref?: string
        status?: string
      }
    }

    const event = body.event
    const reference = body.data?.reference ?? body.data?.tx_ref

    if (!event || !reference) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'Invalid Paystack webhook payload: missing event or reference',
      )
    }

    // Paystack may include a root `id` for the webhook; otherwise hash event + reference
    const providerEventId =
      body.id != null
        ? String(body.id)
        : createHash('sha256').update(`${event}:${reference}`).digest('hex')

    // rawStatus is the event name; providerStatus carries the transaction status
    return {
      externalRefSource: 'paystack',
      externalRef: reference,
      rawStatus: event,
      providerStatus: body.data?.status,
      providerEventId,
    }
  }

  // ---- Status mapping -----------------------------------------------------

  mapStatus(input: MapStatusInput): InternalPaymentStatus {
    const { rawStatus, providerStatus } = input

    // Check event-name map first (webhook path)
    if (rawStatus in PAYSTACK_EVENT_MAP) {
      return PAYSTACK_EVENT_MAP[rawStatus]!
    }

    // Check transaction-status map (verify path)
    if (providerStatus) {
      const byProvider = PAYSTACK_TX_STATUS_MAP[providerStatus.toLowerCase()]
      if (byProvider) return byProvider
    }

    // Fallback: treat unknown events as confirmed to avoid losing real payments
    // (reconciliation will catch discrepancies)
    return 'confirmed'
  }

  // ---- Payout execution ---------------------------------------------------

  async executePayout(input: ExecutePayoutInput): Promise<ExecutePayoutResult> {
    /**
     * Paystack payout flow:
     *  1. Create a transfer recipient (nuban)
     *  2. Initiate a transfer using the recipient code
     *
     * Recipients are created on-demand. In a future iteration a recipient store
     * can be added to avoid redundant API calls for the same account.
     */

    // Step 1 — create recipient
    const recipientData = await paystackPost<{ recipient_code: string }>(
      '/transferrecipient',
      {
        type: 'nuban',
        name: input.bankAccount.accountName,
        account_number: input.bankAccount.accountNumber,
        bank_code: input.bankAccount.bankName, // caller must supply bank code here
        currency: 'NGN',
      },
    )

    // Step 2 — initiate transfer
    const amountKobo = Math.round(input.amountNgn * 100)

    type TransferResponse = {
      transfer_code: string
      status: string
      reference: string
    }

    const transfer = await paystackPost<TransferResponse>('/transfer', {
      source: 'balance',
      amount: amountKobo,
      recipient: recipientData.recipient_code,
      reference: input.internalRef,
      reason: `Quipay payout — ${input.userId}`,
    })

    const status: ExecutePayoutResult['status'] =
      transfer.status === 'success' || transfer.status === 'otp' ? 'confirmed' : 'failed'

    return {
      externalRefSource: 'paystack',
      externalRef: transfer.reference ?? input.internalRef,
      status,
      providerStatus: transfer.status,
    }
  }
}
