import { act, renderHook } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotificationUnread } from '../use-notification-unread'
import { useUnreadCount, type UseUnreadCountResult } from '../use-unread-count'

vi.mock('../use-unread-count', () => ({
  useUnreadCount: vi.fn(),
}))

const mockUseUnreadCount = vi.mocked(useUnreadCount)

function unreadResult(totalUnread: number): UseUnreadCountResult {
  return {
    unread: totalUnread,
    totalUnread,
    notifUnread: totalUnread,
    notifications: [],
    notifConnected: true,
    isConnected: true,
  }
}

describe('useNotificationUnread', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockUseUnreadCount.mockReturnValue(unreadResult(0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with the upstream unread count and a null error', () => {
    const { result } = renderHook(() => useNotificationUnread())

    expect(result.current.unread).toBe(0)
    expect(result.current.error).toBeNull()
    expect(typeof result.current.refresh).toBe('function')
    expect(() => result.current.refresh()).not.toThrow()
  })

  it('follows upstream unread count updates on rerender', () => {
    mockUseUnreadCount.mockReturnValue(unreadResult(3))
    const { result, rerender } = renderHook(() => useNotificationUnread())

    expect(result.current.unread).toBe(3)

    mockUseUnreadCount.mockReturnValue(unreadResult(8))
    act(() => {
      rerender()
    })

    expect(result.current.unread).toBe(8)
    expect(result.current.error).toBeNull()
  })

  it('propagates errors thrown by the upstream hook', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUseUnreadCount.mockImplementation(() => {
      throw new Error('upstream failure')
    })

    expect(() => renderHook(() => useNotificationUnread())).toThrow('upstream failure')

    consoleError.mockRestore()
  })

  it('follows live updates and releases the upstream subscription on unmount', () => {
    const listeners = new Set<(count: number) => void>()
    mockUseUnreadCount.mockImplementation(() => {
      const [count, setCount] = useState(2)
      useEffect(() => {
        listeners.add(setCount)
        return () => {
          listeners.delete(setCount)
        }
      }, [])
      return unreadResult(count)
    })

    const { result, unmount } = renderHook(() => useNotificationUnread())
    expect(result.current.unread).toBe(2)
    expect(listeners.size).toBe(1)

    act(() => {
      listeners.forEach((listener) => listener(9))
    })
    expect(result.current.unread).toBe(9)

    unmount()
    expect(listeners.size).toBe(0)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.unread).toBe(9)
  })
})
