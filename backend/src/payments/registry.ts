import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { StubPspProvider } from './stubPspProvider.js'
import type { PaymentProvider } from './types.js'

const stubPspProviders: Map<string, StubPspProvider> = new Map()

export function getPaymentProvider(rail: string): PaymentProvider {
  const normalized = String(rail).toLowerCase()

  if (normalized === 'psp' || normalized === 'paystack' || normalized === 'flutterwave' || normalized === 'manual_admin') {
    // Return cached provider or create new one with the specific rail
    if (!stubPspProviders.has(normalized)) {
      stubPspProviders.set(normalized, new StubPspProvider(normalized))
    }
    return stubPspProviders.get(normalized)!
  }

  throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Unsupported payment rail')
}
