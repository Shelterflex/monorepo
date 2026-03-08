import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { StubPspProvider } from './stubPspProvider.js'
import type { PaymentProvider } from './types.js'

const stubPspProvider = new StubPspProvider()

export function getPaymentProvider(rail: string): PaymentProvider {
  const normalized = String(rail).toLowerCase()

  if (normalized === 'psp' || normalized === 'paystack' || normalized === 'flutterwave' || normalized === 'manual_admin') {
    return stubPspProvider
  }

  throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Unsupported payment rail')
}
