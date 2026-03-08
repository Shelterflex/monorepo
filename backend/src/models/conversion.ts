export type ConversionStatus = 'pending' | 'completed' | 'failed'

export interface Conversion {
  id: string
  from: 'NGN' | 'USDC'
  to: 'NGN' | 'USDC'
  amount: number
  status: ConversionStatus
  createdAt: Date
  updatedAt: Date
  externalRefSource?: string
  externalRef?: string
}

