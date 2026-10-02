import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useNotifications } from '../useNotifications'

const mockFetchUnreadCount = vi.fn()
const mockGetToken = vi.fn()
let mockLastMessage: any = null
let mockIsConnected = false

vi.mock('@/lib/auth', () => ({
  getToken: () => mockGetToken(),
}))

vi.mock('@/lib/notificationsApi', () => ({
  fetchUnreadCount: () => mockFetchUnreadCount(),
}))

vi.mock('../use-websocket', () => ({
  useWebSocket: vi.fn(() => ({
    isConnected: mockIsConnected,
    isConnecting: false,
    connectionStatus: mockIsConnected ? 'live' : 'disconnected',
    error: null,
    lastMessage: mockLastMessage,
    reconnectAttempts: 0,
    send: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
  })),
}))

describe('useNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetToken.mockReturnValue('test-token')
    mockFetchUnreadCount.mockResolvedValue({ data: { unread: 3 } })
    mockLastMessage = null
    mockIsConnected = true
  })

  it('fetches unread count on mount', async () => {
    const { result } = renderHook(() => useNotifications())

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(3)
    })
    expect(mockFetchUnreadCount).toHaveBeenCalledTimes(1)
  })

  it('updates notifications and increments unread count on new notification message', async () => {
    const { result, rerender } = renderHook(() => useNotifications())

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(3)
    })

    const newNotif = {
      id: 'notif-1',
      title: 'New Lease Update',
      body: 'Your lease has been approved',
      notificationType: 'lease_update',
      createdAt: new Date().toISOString(),
    }

    mockLastMessage = {
      type: 'notification',
      payload: newNotif,
    }

    rerender()

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(4)
      expect(result.current.notifications).toHaveLength(1)
      expect(result.current.notifications[0].title).toBe('New Lease Update')
    })
  })
})
