export enum DepositStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  REVERSED = 'reversed',
}

export interface CustomerMeta {
  name?: string
  phone?: string
}

export interface Deposit {
  depositId: string
  quoteId: string
  userId: string
  paymentRail: string
  amountNgn: number
  status: DepositStatus
  externalRefSource?: string
  externalRef?: string
  confirmedAt?: Date
  customerMeta?: CustomerMeta
  createdAt: Date
  updatedAt: Date
}

export interface CreateDepositInput {
  quoteId: string
  userId: string
  paymentRail: string
  amountNgn: number
  customerMeta?: CustomerMeta
}

export type DepositRecordStatus = 'confirmed' | 'consumed'

export type DepositProvider = 'onramp' | 'offramp' | 'manual_admin'

export interface DepositRecord {
  depositId: string
  userId: string
  amountNgn: number
  provider: DepositProvider
  providerRef: string
  status: DepositRecordStatus
  createdAt: Date
  updatedAt: Date
  consumedAt: Date | null
  reversedAt: Date | null
  reversalRef: string | null
}

export interface ConfirmDepositRecordInput {
  depositId: string
  userId: string
  amountNgn: number
  provider: DepositProvider
  providerRef: string
}
