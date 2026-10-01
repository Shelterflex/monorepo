import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useUnreadCount } from '../use-unread-count'

const mockUseNotifications = vi.fn()
const mockUseUnreadMessageCount = vi.fn()

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => mockUseNotifications(),
}))

vi.mock('@/hooks/useUnreadMessageCount', () => ({
  useUnreadMessageCount: () => mockUseUnreadMessageCount(),
}))

describe('useUnreadCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aggregates unread counts from notifications and messages', () => {
    mockUseNotifications.mockReturnValue({
      unreadCount: 4,
      notifications: [{ id: '1', title: 'Test' }],
      isConnected: true,
    })
    mockUseUnreadMessageCount.mockReturnValue({
      unreadCount: 3,
      isConnected: true,
    })

    const { result } = renderHook(() => useUnreadCount())

    expect(result.current.notifUnread).toBe(4)
    expect(result.current.msgUnread).toBe(3)
    expect(result.current.totalUnread).toBe(7)
    expect(result.current.unread).toBe(7)
    expect(result.current.isConnected).toBe(true)
    expect(result.current.notifications).toHaveLength(1)
  })

  it('reports isConnected false if either stream is disconnected', () => {
    mockUseNotifications.mockReturnValue({
      unreadCount: 0,
      notifications: [],
      isConnected: true,
    })
    mockUseUnreadMessageCount.mockReturnValue({
      unreadCount: 0,
      isConnected: false,
    })

    const { result } = renderHook(() => useUnreadCount())

    expect(result.current.totalUnread).toBe(0)
    expect(result.current.isConnected).toBe(false)
    expect(result.current.notifConnected).toBe(true)
    expect(result.current.msgConnected).toBe(false)
  })
})
