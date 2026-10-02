import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardHeader } from '../dashboard-header'

const mockUseUnreadCount = vi.fn()

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/hooks/use-unread-count', () => ({
  useUnreadCount: () => mockUseUnreadCount(),
}))

describe('DashboardHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without badge when unread is 0', () => {
    mockUseUnreadCount.mockReturnValue({
      totalUnread: 0,
      unread: 0,
    })

    render(<DashboardHeader />)

    const bellButton = screen.getByRole('button', { name: /Notifications$/i })
    expect(bellButton).toBeInTheDocument()
    expect(screen.queryByText(/9\+/)).not.toBeInTheDocument()
  })

  it('renders badge with unread count matching useUnreadCount', () => {
    mockUseUnreadCount.mockReturnValue({
      totalUnread: 5,
      unread: 5,
    })

    render(<DashboardHeader />)

    const bellButton = screen.getByRole('button', { name: /Notifications, 5 unread/i })
    expect(bellButton).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})
