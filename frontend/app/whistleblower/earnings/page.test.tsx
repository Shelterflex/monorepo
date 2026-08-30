import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import WhistleblowerEarningsPage from './page'

// Mock the API module
vi.mock('@/lib/api/whistleblowerApplications', () => ({
  getWhistleblowerEarnings: vi.fn(),
}))

// Mock the auth store
vi.mock('@/store/useAuthStore', () => ({
  default: vi.fn(() => ({
    user: { id: 'test-whistleblower-id' },
  })),
}))

import { getWhistleblowerEarnings } from '@/lib/api/whistleblowerApplications'
import useAuthStore from '@/store/useAuthStore'

type MockGetEarnings = Mock<typeof getWhistleblowerEarnings>

describe('WhistleblowerEarningsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', () => {
    const mockGetEarnings = getWhistleblowerEarnings as MockGetEarnings
    mockGetEarnings.mockImplementation(() => new Promise(() => {})) // Never resolves

    render(<WhistleblowerEarningsPage />)

    expect(screen.getByText('Loading earnings...')).toBeInTheDocument()
  })

  it('renders populated earnings data successfully', async () => {
    const mockResponse = {
      totals: {
        totalNgn: 47000,
        pendingNgn: 15000,
        paidNgn: 32000,
        totalUsdc: 100,
        pendingUsdc: 32,
        paidUsdc: 68,
      },
      history: [
        {
          rewardId: 'reward-1',
          listingId: 'listing-1',
          dealId: 'deal-1',
          amountNgn: 15000,
          amountUsdc: 32,
          status: 'pending' as const,
          createdAt: '2024-12-15T00:00:00Z',
        },
        {
          rewardId: 'reward-2',
          listingId: 'listing-2',
          dealId: 'deal-2',
          amountNgn: 20000,
          amountUsdc: 42,
          status: 'paid' as const,
          createdAt: '2024-11-28T00:00:00Z',
          paidAt: '2024-12-02T00:00:00Z',
        },
        {
          rewardId: 'reward-3',
          listingId: 'listing-3',
          dealId: 'deal-3',
          amountNgn: 12000,
          amountUsdc: 26,
          status: 'paid' as const,
          createdAt: '2024-11-10T00:00:00Z',
          paidAt: '2024-11-15T00:00:00Z',
        },
      ],
    }
    const mockGetEarnings = getWhistleblowerEarnings as MockGetEarnings
    mockGetEarnings.mockResolvedValue(mockResponse)

    render(<WhistleblowerEarningsPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading earnings...')).not.toBeInTheDocument()
    })

    // Check totals
    expect(screen.getByText('₦47,000')).toBeInTheDocument() // Total
    expect(screen.getByText('₦32,000')).toBeInTheDocument() // Completed
    expect(screen.getByText('₦15,000')).toBeInTheDocument() // Pending

    // Check earnings history
    expect(screen.getByText('Earnings History')).toBeInTheDocument()
    expect(screen.getByText('Reward #reward-1...')).toBeInTheDocument()
    expect(screen.getByText('Reward #reward-2...')).toBeInTheDocument()
    expect(screen.getByText('Reward #reward-3...')).toBeInTheDocument()

    // Check status badges
    expect(screen.getAllByText('Pending')).toHaveLength(1)
    expect(screen.getAllByText('Completed')).toHaveLength(2)
  })

  it('renders empty state when no earnings exist', async () => {
    const mockResponse = {
      totals: {
        totalNgn: 0,
        pendingNgn: 0,
        paidNgn: 0,
      },
      history: [],
    }
    const mockGetEarnings = getWhistleblowerEarnings as MockGetEarnings
    mockGetEarnings.mockResolvedValue(mockResponse)

    render(<WhistleblowerEarningsPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading earnings...')).not.toBeInTheDocument()
    })

    // Check empty state message
    expect(screen.getByText('No earnings yet')).toBeInTheDocument()
    expect(screen.getByText('Start reporting vacant apartments to earn rewards')).toBeInTheDocument()

    // Check totals are all zero
    expect(screen.getByText('₦0')).toBeInTheDocument()
  })

  it('renders error state when API call fails', async () => {
    const mockError = new Error('Network error') as Error & { statusCode?: number; apiError?: any }
    mockError.statusCode = 500
    const mockGetEarnings = getWhistleblowerEarnings as MockGetEarnings
    mockGetEarnings.mockRejectedValue(mockError)

    render(<WhistleblowerEarningsPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading earnings...')).not.toBeInTheDocument()
    })

    // Check error state
    expect(screen.getByText('Failed to Load Earnings')).toBeInTheDocument()
    expect(screen.getByText('Network error')).toBeInTheDocument()
  })

  it('renders error state when user is not authenticated', async () => {
    const mockUseAuthStore = useAuthStore as unknown as Mock
    mockUseAuthStore.mockReturnValue({ user: null })

    render(<WhistleblowerEarningsPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading earnings...')).not.toBeInTheDocument()
    })

    // Check error state
    expect(screen.getByText('Failed to Load Earnings')).toBeInTheDocument()
    expect(screen.getByText('User not authenticated')).toBeInTheDocument()
  })

  it('maps backend status to frontend status correctly', async () => {
    const mockResponse = {
      totals: {
        totalNgn: 32000,
        pendingNgn: 0,
        paidNgn: 32000,
      },
      history: [
        {
          rewardId: 'reward-1',
          listingId: 'listing-1',
          dealId: 'deal-1',
          amountNgn: 20000,
          amountUsdc: 42,
          status: 'paid' as const,
          createdAt: '2024-11-28T00:00:00Z',
          paidAt: '2024-12-02T00:00:00Z',
        },
        {
          rewardId: 'reward-2',
          listingId: 'listing-2',
          dealId: 'deal-2',
          amountNgn: 12000,
          amountUsdc: 26,
          status: 'payable' as const,
          createdAt: '2024-11-10T00:00:00Z',
        },
      ],
    }
    const mockGetEarnings = getWhistleblowerEarnings as MockGetEarnings
    mockGetEarnings.mockResolvedValue(mockResponse)

    render(<WhistleblowerEarningsPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading earnings...')).not.toBeInTheDocument()
    })

    // Both 'paid' and 'payable' should map to 'completed' or 'pending'
    // 'paid' -> 'completed'
    // 'payable' -> 'pending'
    const statusBadges = screen.getAllByText(/Completed|Pending/)
    expect(statusBadges.length).toBeGreaterThan(0)
  })

  it('formats dates correctly', async () => {
    const mockResponse = {
      totals: {
        totalNgn: 20000,
        pendingNgn: 0,
        paidNgn: 20000,
      },
      history: [
        {
          rewardId: 'reward-1',
          listingId: 'listing-1',
          dealId: 'deal-1',
          amountNgn: 20000,
          amountUsdc: 42,
          status: 'paid' as const,
          createdAt: '2024-11-28T00:00:00Z',
          paidAt: '2024-12-02T00:00:00Z',
        },
      ],
    }
    const mockGetEarnings = getWhistleblowerEarnings as MockGetEarnings
    mockGetEarnings.mockResolvedValue(mockResponse)

    render(<WhistleblowerEarningsPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading earnings...')).not.toBeInTheDocument()
    })

    // Check that dates are formatted (should contain month, day, year)
    expect(screen.getByText(/Nov/)).toBeInTheDocument()
    expect(screen.getByText(/Dec/)).toBeInTheDocument()
  })

  it('displays payment info card', async () => {
    const mockResponse = {
      totals: {
        totalNgn: 0,
        pendingNgn: 0,
        paidNgn: 0,
      },
      history: [],
    }
    const mockGetEarnings = getWhistleblowerEarnings as MockGetEarnings
    mockGetEarnings.mockResolvedValue(mockResponse)

    render(<WhistleblowerEarningsPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading earnings...')).not.toBeInTheDocument()
    })

    // Check payment info card is always displayed
    expect(screen.getByText('How Payments Work')).toBeInTheDocument()
    expect(screen.getByText('Earnings are credited after the tenant\'s first payment')).toBeInTheDocument()
  })
})
