/**
 * FlutterwaveProvider — production adapter for the Flutterwave payment rail.
 *
 * API reference: https://developer.flutterwave.com/docs/
 *
 * Credential env vars (set via PSP_PROVIDER_FLUTTERWAVE=flutterwave):
 *   FLUTTERWAVE_SECRET      — FLWSECK_...
 *   FLUTTERWAVE_BASE_URL    — override for tests/sandbox (default: https://api.flutterwave.com/v3)
 *   FLUTTERWAVE_REDIRECT_URL — callback after hosted payment page
 *
 * Webhook env var:
 *   FLUTTERWAVE_SECRET      — shared with the signature validator in webhookSignature.ts
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

const FLW_BASE_URL = () =>
  process.env.FLUTTERWAVE_BASE_URL ?? 'https://api.flutterwave.com/v3'

function getSecret(): string {
  const rotating = getRotatingAPIKey('flutterwave')
  if (rotating) return rotating

  const s = process.env.FLUTTERWAVE_SECRET
  if (!s) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      500,
      'FLUTTERWAVE_SECRET is not configured',
    )
  }
  return s
}

async function flwPost<T>(path: string, body: unknown): Promise<T> {
  const secret = getSecret()
  const res = await fetch(`${FLW_BASE_URL()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json()) as { status: string; message: string; data: T }

  if (!res.ok || json.status !== 'success') {
    throw new AppError(
      ErrorCode.PAYMENT_PROVIDER_ERROR,
      502,
      `Flutterwave error: ${json.message ?? res.statusText}`,
    )
  }

  return json.data
}

async function flwGet<T>(path: string): Promise<T> {
  const secret = getSecret()
  const res = await fetch(`${FLW_BASE_URL()}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  })

  const json = (await res.json()) as { status: string; message: string; data: T }

  if (!res.ok || json.status !== 'success') {
    throw new AppError(
      ErrorCode.PAYMENT_PROVIDER_ERROR,
      502,
      `Flutterwave error: ${json.message ?? res.statusText}`,
    )
  }

  return json.data
}

// ---------------------------------------------------------------------------
// Flutterwave-specific status mapping
//
// Webhook event names:
//   charge.completed       → confirmed  (payment successful)
//   charge.failed          → failed
//   transfer.completed     → confirmed  (payout settled)
//   transfer.failed        → failed
//   transfer.reversed      → reversed
//
// Transaction status strings (verify endpoint):
//   successful             → confirmed
//   failed                 → failed
//   pending                → pending
// ---------------------------------------------------------------------------

const FLW_EVENT_MAP: Record<string, InternalPaymentStatus> = {
  'charge.completed': 'confirmed',
  'charge.failed': 'failed',
  'transfer.completed': 'confirmed',
  'transfer.failed': 'failed',
  'transfer.reversed': 'reversed',
}

const FLW_TX_STATUS_MAP: Record<string, InternalPaymentStatus> = {
  successful: 'confirmed',
  success: 'confirmed',
  failed: 'failed',
  pending: 'pending',
  reversed: 'reversed',
}

// ---------------------------------------------------------------------------

export class FlutterwaveProvider implements PaymentProvider {
  readonly name = 'flutterwave'

  // ---- Payment initiation -------------------------------------------------

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    /**
     * Flutterwave standard payment charge — returns a hosted payment link.
     * Amount is in NGN (no kobo conversion needed; FLW accepts decimals).
     */
    const email =
      input.customerMeta?.email ?? `${input.userId}@quipay.internal`

    const data = await flwPost<{ link: string }>('/payments', {
      tx_ref: input.internalRef,
      amount: input.amountNgn,
      currency: 'NGN',
      redirect_url:
        process.env.FLUTTERWAVE_REDIRECT_URL ?? 'https://quipay.app/deposit/callback',
      customer: {
        email,
        name: input.customerMeta?.name ?? input.userId,
        phonenumber: input.customerMeta?.phone,
      },
      meta: {
        internalRef: input.internalRef,
        userId: input.userId,
        rail: input.rail,
      },
    })

    return {
      externalRefSource: 'flutterwave',
      externalRef: input.internalRef, // tx_ref is the canonical reference
      redirectUrl: data.link,
    }
  }

  // ---- Payment verification -----------------------------------------------

  async verifyPayment(input: {
    externalRefSource: string
    externalRef: string
  }): Promise<{ status: InternalPaymentStatus; providerStatus?: string }> {
    /**
     * FLW verify by tx_ref — query the transactions list filtered by tx_ref.
     * Returns the first matching transaction.
     */
    type TxItem = { status: string; tx_ref: string; id: number }
    type ListResponse = TxItem[]

    const data = await flwGet<ListResponse>(
      `/transactions?tx_ref=${encodeURIComponent(input.externalRef)}`,
    )

    if (!data || data.length === 0) {
      return { status: 'pending', providerStatus: 'not_found' }
    }

    const tx = data[0]!
    const providerStatus = tx.status
    const mapped = FLW_TX_STATUS_MAP[providerStatus.toLowerCase()] ?? 'pending'

    return { status: mapped, providerStatus }
  }

  // ---- Webhook parsing & validation ---------------------------------------

  async parseAndValidateWebhook(req: Request): Promise<ParseWebhookResult> {
    // Delegate HMAC-SHA256 validation to the shared utility
    requireValidWebhookSignature(req, 'flutterwave')

    const body = req.body as {
      id?: string | number
      event?: string
      data?: {
        id?: string | number
        tx_ref?: string
        reference?: string
        status?: string
      }
    }

    const event = body.event
    const txRef = body.data?.tx_ref ?? body.data?.reference

    if (!event || !txRef) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'Invalid Flutterwave webhook payload: missing event or tx_ref',
      )
    }

    const providerEventId =
      body.data?.id != null
        ? String(body.data.id)
        : body.id != null
          ? String(body.id)
          : createHash('sha256').update(`${event}:${txRef}`).digest('hex')

    return {
      externalRefSource: 'flutterwave',
      externalRef: txRef,
      rawStatus: event,
      providerStatus: body.data?.status,
      providerEventId,
    }
  }

  // ---- Status mapping -----------------------------------------------------

  mapStatus(input: MapStatusInput): InternalPaymentStatus {
    const { rawStatus, providerStatus } = input

    // Event-name map (webhook path)
    if (rawStatus in FLW_EVENT_MAP) {
      return FLW_EVENT_MAP[rawStatus]!
    }

    // Transaction-status map (verify path)
    if (providerStatus) {
      const byProvider = FLW_TX_STATUS_MAP[providerStatus.toLowerCase()]
      if (byProvider) return byProvider
    }

    // Fallback: assume confirmed; reconciliation will correct discrepancies
    return 'confirmed'
  }

  // ---- Payout execution ---------------------------------------------------

  async executePayout(input: ExecutePayoutInput): Promise<ExecutePayoutResult> {
    /**
     * FLW bank transfer payout.
     * Requires a bank account number and the FLW bank code (not the bank name).
     * Callers should pass the FLW bank code as bankAccount.bankName until a
     * bank-code lookup utility is introduced.
     */
    type TransferData = {
      status: string
      reference: string
      id: number
    }

    const transfer = await flwPost<TransferData>('/transfers', {
      account_bank: input.bankAccount.bankName, // FLW bank code
      account_number: input.bankAccount.accountNumber,
      amount: input.amountNgn,
      narration: `Quipay payout — ${input.userId}`,
      currency: 'NGN',
      reference: input.internalRef,
      callback_url: process.env.FLUTTERWAVE_REDIRECT_URL,
      debit_currency: 'NGN',
    })

    const status: ExecutePayoutResult['status'] =
      transfer.status === 'NEW' || transfer.status === 'success' ? 'confirmed' : 'failed'

    return {
      externalRefSource: 'flutterwave',
      externalRef: transfer.reference ?? input.internalRef,
      status,
      providerStatus: transfer.status,
    }
  }
}
