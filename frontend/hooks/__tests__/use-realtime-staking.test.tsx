import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useRealtimeStaking,
  type StakingPositionUpdate,
  type StakingRewardUpdate,
} from '../use-realtime-staking'
import { useWebSocket, type WebSocketMessage, type WebSocketResult } from '../use-websocket'

vi.mock('../use-websocket', () => ({
  useWebSocket: vi.fn(),
}))

const mockUseWebSocket = vi.mocked(useWebSocket)
const send = vi.fn()

function wsResult(overrides: Partial<WebSocketResult> = {}): WebSocketResult {
  return {
    isConnected: false,
    isConnecting: false,
    connectionStatus: 'disconnected',
    error: null,
    lastMessage: null,
    reconnectAttempts: 0,
    send,
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    ...overrides,
  }
}

function wsMessage(type: string, data: unknown): WebSocketMessage {
  return { type, data, timestamp: '2026-01-01T00:00:00Z' }
}

function rewardUpdate(positionId: string, rewards: number): StakingRewardUpdate {
  return { positionId, rewards, apy: 12.5, timestamp: '2026-01-01T00:00:00Z' }
}

function positionUpdate(positionId: string, amount: number): StakingPositionUpdate {
  return {
    positionId,
    status: 'active',
    amount,
    timestamp: '2026-01-01T00:00:00Z',
  }
}

describe('useRealtimeStaking', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockUseWebSocket.mockReturnValue(wsResult())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts disconnected with empty position and reward maps', () => {
    const { result } = renderHook(() => useRealtimeStaking())

    expect(result.current.connectionStatus).toBe('disconnected')
    expect(result.current.isConnected).toBe(false)
    expect(result.current.isConnecting).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.positions.size).toBe(0)
    expect(result.current.rewards.size).toBe(0)
    expect(result.current.getAllPositions()).toEqual([])
    expect(result.current.getAllRewards()).toEqual([])
    expect(result.current.getTotalRewards()).toBe(0)
    expect(result.current.getPosition('pos-1')).toBeUndefined()
    expect(result.current.getReward('pos-1')).toBeUndefined()
  })

  it('subscribes to the requested positions after connecting', () => {
    const positionIds = ['pos-1', 'pos-2']
    const { rerender } = renderHook(() => useRealtimeStaking({ positionIds }))

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(send).not.toHaveBeenCalled()

    mockUseWebSocket.mockReturnValue(wsResult({ isConnected: true }))
    act(() => {
      rerender()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(send).toHaveBeenCalledWith({
      type: 'subscribe',
      payload: { staking: positionIds },
    })
  })

  it('applies reward messages and replaces older values for the same position', () => {
    const onRewardUpdate = vi.fn()
    const options = { onRewardUpdate }
    const first = rewardUpdate('pos-1', 10)
    const second = rewardUpdate('pos-1', 25)
    const { result, rerender } = renderHook(() => useRealtimeStaking(options))

    mockUseWebSocket.mockReturnValue(wsResult({ lastMessage: wsMessage('staking_reward', first) }))
    act(() => {
      rerender()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(result.current.rewards.get('pos-1')).toEqual(first)
    expect(result.current.getReward('pos-1')?.rewards).toBe(10)
    expect(result.current.getAllRewards()).toEqual([first])
    expect(result.current.getTotalRewards()).toBe(10)
    expect(onRewardUpdate).toHaveBeenCalledWith(first)

    mockUseWebSocket.mockReturnValue(wsResult({ lastMessage: wsMessage('staking_reward', second) }))
    act(() => {
      rerender()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(result.current.getReward('pos-1')).toEqual(second)
    expect(result.current.getTotalRewards()).toBe(25)
    expect(onRewardUpdate).toHaveBeenLastCalledWith(second)
  })

  it('reports position messages without creating an unknown position', () => {
    const onPositionUpdate = vi.fn()
    const options = { onPositionUpdate }
    const update = positionUpdate('pos-1', 5000)
    const { result, rerender } = renderHook(() => useRealtimeStaking(options))

    mockUseWebSocket.mockReturnValue(wsResult({ lastMessage: wsMessage('staking_position', update) }))
    act(() => {
      rerender()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(onPositionUpdate).toHaveBeenCalledWith(update)
    expect(result.current.positions.size).toBe(0)
    expect(result.current.getPosition('pos-1')).toBeUndefined()
  })

  it('enters the error state and reports websocket errors', () => {
    const error = new Error('socket failed')
    const onError = vi.fn()
    const options = { onError }
    const { result, rerender } = renderHook(() => useRealtimeStaking(options))

    mockUseWebSocket.mockReturnValue(wsResult({ isConnecting: true }))
    act(() => {
      rerender()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.connectionStatus).toBe('connecting')

    mockUseWebSocket.mockReturnValue(wsResult({ error }))
    act(() => {
      rerender()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(result.current.connectionStatus).toBe('error')
    expect(result.current.error).toBe(error)
    expect(onError).toHaveBeenCalledWith(error)
  })

  it('cancels pending subscription and message timers on unmount', () => {
    const positionIds = ['pos-1']
    const message = wsMessage('staking_reward', rewardUpdate('pos-1', 10))
    mockUseWebSocket.mockReturnValue(wsResult({ isConnected: true, lastMessage: message }))
    const { result, unmount } = renderHook(() => useRealtimeStaking({ positionIds }))

    unmount()
    act(() => {
      vi.advanceTimersByTime(10)
    })

    expect(send).not.toHaveBeenCalled()
    expect(result.current.rewards.size).toBe(0)
  })

  it('keeps the newest reward when two messages arrive before timers flush', () => {
    const onRewardUpdate = vi.fn()
    const options = { onRewardUpdate }
    const stale = rewardUpdate('pos-1', 5)
    const fresh = rewardUpdate('pos-1', 50)
    const { result, rerender } = renderHook(() => useRealtimeStaking(options))

    mockUseWebSocket.mockReturnValue(wsResult({ lastMessage: wsMessage('staking_reward', stale) }))
    act(() => {
      rerender()
    })

    mockUseWebSocket.mockReturnValue(wsResult({ lastMessage: wsMessage('staking_reward', fresh) }))
    act(() => {
      rerender()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(result.current.getReward('pos-1')).toEqual(fresh)
    expect(result.current.getTotalRewards()).toBe(50)
    expect(onRewardUpdate).toHaveBeenCalledTimes(2)
    expect(onRewardUpdate).toHaveBeenNthCalledWith(2, fresh)
  })
})
