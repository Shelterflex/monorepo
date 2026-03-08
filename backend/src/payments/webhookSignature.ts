import type { Request } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

export function shouldValidateWebhookSignature(): boolean {
  const nodeEnv = process.env.NODE_ENV
  if (nodeEnv === 'production') return true
  return process.env.WEBHOOK_SIGNATURE_ENABLED === 'true'
}

export function requireValidWebhookSignature(req: Request): void {
  if (!shouldValidateWebhookSignature()) return

  const secret = process.env.WEBHOOK_SECRET
  if (!secret) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'Webhook secret not configured')
  }

  const sig = req.headers['x-webhook-signature']
  if (typeof sig !== 'string' || sig !== secret) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid webhook signature')
  }
}
