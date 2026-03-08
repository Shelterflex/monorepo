export type QuoteStatus = 'active' | 'expired' | 'used' | 'cancelled'

export type PaymentRail = 'paystack' | 'flutterwave' | 'bank_transfer' | 'manual_admin'

export interface QuoteRecord {
  quoteId: string
  userId: string
  amountNgn: number
  paymentRail: PaymentRail
  estimatedAmountUsdc: string
  fxRateNgnPerUsdc: number
  feesNgn: number
  expiresAt: Date
  status: QuoteStatus
  createdAt: Date
  updatedAt: Date
}
