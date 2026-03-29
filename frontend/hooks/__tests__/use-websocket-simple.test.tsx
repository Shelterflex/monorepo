import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from '../use-websocket'

// Mock WebSocket
const mockWebSocket = vi.fn()
vi.stubGlobal('WebSocket', mockWebSocket)

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should connect to WebSocket on mount', () => {
    const mockWs = {
      readyState: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(),
    }
    
    mockWebSocket.mockImplementation(() => mockWs)

    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost:3000/ws' })
    )

    expect(mockWebSocket).toHaveBeenCalledWith('ws://localhost:3000/ws', undefined)
    expect(result.current.isConnecting).toBe(true)
  })

  it('should handle incoming messages', () => {
    const mockWs = {
      readyState: 1,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(),
    }
    
    mockWebSocket.mockImplementation(() => mockWs)

    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost:3000/ws' })
    )

    const testMessage = {
      type: 'transaction_status',
      data: { id: 'tx-1', status: 'confirmed' },
      timestamp: new Date().toISOString(),
    }

    act(() => {
      if (mockWs.onmessage) {
        mockWs.onmessage({ data: JSON.stringify(testMessage) })
      }
    })

    expect(result.current.lastMessage).toEqual(testMessage)
  })

  it('should send messages', () => {
    const mockWs = {
      readyState: 1,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(),
    }
    
    mockWebSocket.mockImplementation(() => mockWs)

    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost:3000/ws' })
    )

    const message = { type: 'subscribe', payload: { transactions: ['tx-1'] } }

    act(() => {
      result.current.send(message)
    })

    expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(message))
  })

  it('should handle connection errors', () => {
    const mockWs = {
      readyState: 3,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(),
    }
    
    mockWebSocket.mockImplementation(() => mockWs)

    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost:3000/ws' })
    )

    act(() => {
      if (mockWs.onerror) {
        mockWs.onerror(new Event('error'))
      }
    })

    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('should allow manual disconnect', () => {
    const mockWs = {
      readyState: 1,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(),
    }
    
    mockWebSocket.mockImplementation(() => mockWs)

    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost:3000/ws' })
    )

    act(() => {
      result.current.disconnect()
    })

    expect(mockWs.close).toHaveBeenCalled()
  })

  it('should allow manual reconnection', () => {
    const mockWs = {
      readyState: 1,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(),
    }
    
    mockWebSocket.mockImplementation(() => mockWs)

    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost:3000/ws' })
    )

    act(() => {
      result.current.disconnect()
    })

    act(() => {
      result.current.reconnect()
    })

    expect(mockWebSocket).toHaveBeenCalledTimes(2)
  })
})
