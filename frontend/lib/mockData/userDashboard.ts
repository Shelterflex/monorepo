export type UserSavedProperty = {
  id: number
  title: string
  location: string
  priceNgnPerYear: number
}

export type UserRentalApplicationStatus =
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'

export type UserRentalApplication = {
  id: string
  property: {
    title: string
    location: string
    priceNgnPerYear: number
  }
  status: UserRentalApplicationStatus
  submittedAt: string
}

export type WalletBalance = {
  availableNgn: number
  heldNgn: number
  totalNgn: number
  availableUsdc: string
  heldUsdc: string
  totalUsdc: string
}

export type WalletLedgerEntryStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'confirmed'
  | 'failed'
  | 'reversed'

export type WalletLedgerEntryType =
  | 'top_up'
  | 'topup_pending'
  | 'topup_confirmed'
  | 'top_up_reversed'
  | 'topup_reversed'
  | 'withdrawal'
  | 'stake'
  | 'stake_reserve'
  | 'stake_release'
  | 'unstake'
  | 'reward'
  | 'conversion_debit'

export type WalletLedgerEntry = {
  id: string
  type: WalletLedgerEntryType
  amountNgn: number
  amountUsdc?: string
  status: WalletLedgerEntryStatus
  timestamp: string
  reference: string | null
}

export const userSavedProperties: UserSavedProperty[] = [
  {
    id: 1,
    title: 'Luxury 2BR in VI',
    location: 'Victoria Island',
    priceNgnPerYear: 2800000,
  },
  {
    id: 2,
    title: 'Spacious Studio',
    location: 'Ikeja GRA',
    priceNgnPerYear: 1500000,
  },
  {
    id: 3,
    title: 'Modern 3 Bedroom Flat',
    location: 'Lekki Phase 1',
    priceNgnPerYear: 3200000,
  },
]

export const userRentalApplications: UserRentalApplication[] = [
  {
    id: 'APP-2025-0001',
    property: {
      title: 'Modern 3-Bedroom Apartment',
      location: 'Lekki Phase 1, Lagos',
      priceNgnPerYear: 2400000,
    },
    status: 'under_review',
    submittedAt: '2025-01-12T10:30:00.000Z',
  },
  {
    id: 'APP-2024-0934',
    property: {
      title: 'Cozy 2-Bedroom Flat',
      location: 'Yaba, Lagos',
      priceNgnPerYear: 1800000,
    },
    status: 'rejected',
    submittedAt: '2024-12-03T14:10:00.000Z',
  },
  {
    id: 'APP-2024-0888',
    property: {
      title: 'Contemporary 2-Bedroom Apartment',
      location: 'Lekki Chevron, Lagos',
      priceNgnPerYear: 2200000,
    },
    status: 'approved',
    submittedAt: '2024-11-20T09:05:00.000Z',
  },
]

export const userWalletBalance: WalletBalance = {
  availableNgn: 150000,
  heldNgn: 25000,
  totalNgn: 175000,
  availableUsdc: '24.50',
  heldUsdc: '5.00',
  totalUsdc: '29.50',
}

export const userWalletLedger: WalletLedgerEntry[] = [
  {
    id: 'ngn-ledger-001',
    type: 'top_up',
    amountNgn: 50000,
    status: 'confirmed',
    timestamp: '2025-01-18T08:15:00.000Z',
    reference: 'psp_paystack_123',
  },
  {
    id: 'ngn-ledger-002',
    type: 'conversion_debit',
    amountNgn: 30000,
    amountUsdc: '19.35',
    status: 'confirmed',
    timestamp: '2025-01-21T16:40:00.000Z',
    reference: 'conv_9d12d',
  },
  {
    id: 'ngn-ledger-003',
    type: 'withdrawal',
    amountNgn: 20000,
    status: 'pending',
    timestamp: '2025-01-25T12:05:00.000Z',
    reference: 'wd_1a2b3c',
  },
  {
    id: 'ngn-ledger-004',
    type: 'reward',
    amountNgn: 10000,
    amountUsdc: '6.45',
    status: 'confirmed',
    timestamp: '2025-02-01T11:25:00.000Z',
    reference: null,
  },
]
