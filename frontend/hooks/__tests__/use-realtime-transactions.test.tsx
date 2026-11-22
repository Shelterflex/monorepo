import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useRealtimeTransactions,
  type RealtimeTransaction,
} from '../use-realtime-transactions'
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

function transaction(id: string, status: RealtimeTransaction['status'], txId?: string): RealtimeTransaction {
  return {
    id,
    status,
    txId,
    timestamp: '2026-01-01T00:00:00Z',
  }
}

describe('useRealtimeTransactions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockUseWebSocket.mockReturnValue(wsResult())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts disconnected with an empty transaction map', () => {
    const { result } = renderHook(() => useRealtimeTransactions())

    expect(result.current.connectionStatus).toBe('disconnected')
    expect(result.current.isConnected).toBe(false)
    expect(result.current.isConnecting).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.transactions.size).toBe(0)
    expect(result.current.getAllTransactions()).toEqual([])
    expect(result.current.getTransactionsByStatus('pending')).toEqual([])
    expect(result.current.getTransaction('tx-1')).toBeUndefined()
  })

  it('subscribes to the requested transactions after connecting', () => {
    const transactionIds = ['tx-1', 'tx-2']
    const { rerender } = renderHook(() => useRealtimeTransactions({ transactionIds }))

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
      payload: { transactions: transactionIds },
    })
  })

  it('applies status messages and replaces older values for the same transaction', () => {
    const onStatusChange = vi.fn()
    const options = { onStatusChange }
    const pending = transaction('tx-1', 'pending')
    const confirmed = transaction('tx-1', 'confirmed', '0xabc')
    const { result, rerender } = renderHook(() => useRealtimeTransactions(options))

    mockUseWebSocket.mockReturnValue(wsResult({ lastMessage: wsMessage('transaction_status', pending) }))
    act(() => {
      rerender()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(result.current.transactions.get('tx-1')).toEqual(pending)
    expect(result.current.getTransaction('tx-1')).toEqual(pending)
    expect(result.current.getAllTransactions()).toEqual([pending])
    expect(result.current.getTransactionsByStatus('pending')).toEqual([pending])
    expect(onStatusChange).toHaveBeenCalledWith(pending)

    mockUseWebSocket.mockReturnValue(wsResult({ lastMessage: wsMessage('transaction_status', confirmed) }))
    act(() => {
      rerender()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(result.current.getTransaction('tx-1')).toEqual(confirmed)
    expect(result.current.getTransactionsByStatus('confirmed')).toEqual([confirmed])
    expect(result.current.getTransactionsByStatus('pending')).toEqual([])
    expect(onStatusChange).toHaveBeenLastCalledWith(confirmed)
  })

  it('ignores messages that are not transaction status updates', () => {
    const onStatusChange = vi.fn()
    const options = { onStatusChange }
    const { result, rerender } = renderHook(() => useRealtimeTransactions(options))

    mockUseWebSocket.mockReturnValue(wsResult({ lastMessage: wsMessage('system_notification', { id: 'n-1' }) }))
    act(() => {
      rerender()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(result.current.transactions.size).toBe(0)
    expect(onStatusChange).not.toHaveBeenCalled()
  })

  it('enters the error state and reports websocket errors', () => {
    const error = new Error('socket failed')
    const onError = vi.fn()
    const options = { onError }
    const { result, rerender } = renderHook(() => useRealtimeTransactions(options))

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
    const transactionIds = ['tx-1']
    const message = wsMessage('transaction_status', transaction('tx-1', 'confirmed'))
    mockUseWebSocket.mockReturnValue(wsResult({ isConnected: true, lastMessage: message }))
    const { result, unmount } = renderHook(() => useRealtimeTransactions({ transactionIds }))

    unmount()
    act(() => {
      vi.advanceTimersByTime(10)
    })

    expect(send).not.toHaveBeenCalled()
    expect(result.current.transactions.size).toBe(0)
  })

  it('keeps the newest status when two messages arrive before timers flush', () => {
    const onStatusChange = vi.fn()
    const options = { onStatusChange }
    const stale = transaction('tx-1', 'pending', '0xold')
    const fresh = transaction('tx-1', 'failed', '0xnew')
    const { result, rerender } = renderHook(() => useRealtimeTransactions(options))

    mockUseWebSocket.mockReturnValue(wsResult({ lastMessage: wsMessage('transaction_status', stale) }))
    act(() => {
      rerender()
    })

    mockUseWebSocket.mockReturnValue(wsResult({ lastMessage: wsMessage('transaction_status', fresh) }))
    act(() => {
      rerender()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(result.current.getTransaction('tx-1')).toEqual(fresh)
    expect(result.current.getTransactionsByStatus('failed')).toEqual([fresh])
    expect(onStatusChange).toHaveBeenCalledTimes(2)
    expect(onStatusChange).toHaveBeenNthCalledWith(2, fresh)
  })
})
