export type DepositStatus = 'unmatched' | 'matched' | 'reversed'

export interface Deposit {
  id: string
  accountId: string
  externalRefSource: string
  externalRef: string
  amountNgn: number
  status: DepositStatus
  createdAt: Date
  matchedAt?: Date
  reversalId?: string
}

