export type NgnDepositRail = 'paystack' | 'flutterwave' | 'bank_transfer' | 'manual_admin'

export type NgnDepositStatus = 'pending' | 'confirmed' | 'failed' | 'reversed'

export interface NgnDeposit {
  depositId: string
  userId: string
  amountNgn: number
  rail: NgnDepositRail
  externalRefSource: string | null
  externalRef: string | null
  redirectUrl: string | null
  bankDetails: Record<string, string> | null
  idempotencyKey: string | null
  status: NgnDepositStatus
  createdAt: Date
  updatedAt: Date
}

export interface CreateNgnDepositInput {
  userId: string
  amountNgn: number
  rail: NgnDepositRail
  idempotencyKey?: string | null
}

export interface AttachExternalRefInput {
  depositId: string
  externalRefSource: string
  externalRef: string
  redirectUrl?: string | null
  bankDetails?: Record<string, string> | null
}
