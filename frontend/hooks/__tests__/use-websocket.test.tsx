import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useWebSocket } from '../use-websocket'

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  url: string
  protocols?: string[]
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  send = vi.fn()
  close = vi.fn()

  constructor(url: string, protocols?: string[]) {
    this.url = url
    this.protocols = protocols
    
    // Simulate connection opening
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      if (this.onopen) {
        this.onopen(new Event('open'))
      }
    }, 10)
  }

  // Helper method for testing
  simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }))
    }
  }

  simulateError() {
    this.readyState = MockWebSocket.CLOSED
    if (this.onerror) {
      this.onerror(new Event('error'))
    }
    if (this.onclose) {
      this.onclose(new CloseEvent('close'))
    }
  }
}

// Mock global WebSocket
const mockWebSocket = vi.fn(MockWebSocket)
vi.stubGlobal('WebSocket', mockWebSocket)

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should connect to WebSocket on mount', async () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost:3000/ws' })
    )

    await waitFor(() => {
      expect(result.current.isConnecting).toBe(true)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
      expect(result.current.isConnecting).toBe(false)
    })
  })

  it('should handle incoming messages', async () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost:3000/ws' })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    const testMessage = {
      type: 'transaction_status',
      data: { id: 'tx-1', status: 'confirmed' },
      timestamp: new Date().toISOString(),
    }

    act(() => {
      // Get the WebSocket instance and simulate a message
      const ws = mockWebSocket.mock.instances[0] as MockWebSocket
      ws.simulateMessage(testMessage)
    })

    expect(result.current.lastMessage).toEqual(testMessage)
  })

  it('should send messages', async () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost:3000/ws' })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    const message = { type: 'subscribe', payload: { transactions: ['tx-1'] } }

    act(() => {
      result.current.send(message)
    })

    const ws = mockWebSocket.mock.instances[0] as MockWebSocket
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify(message))
  })

  it('should handle connection errors', async () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost:3000/ws' })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    act(() => {
      const ws = mockWebSocket.mock.instances[0] as MockWebSocket
      ws.simulateError()
    })

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false)
      expect(result.current.error).toBeInstanceOf(Error)
    })
  })

  it('should attempt reconnection on disconnect', async () => {
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:3000/ws',
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
      })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    // Simulate disconnection
    act(() => {
      const ws = mockWebSocket.mock.instances[0] as MockWebSocket
      ws.simulateError()
    })

    // Should attempt reconnection
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(result.current.reconnectAttempts).toBe(1)
    expect(mockWebSocket).toHaveBeenCalledTimes(2)
  })

  it('should stop reconnecting after max attempts', async () => {
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:3000/ws',
        reconnectInterval: 100,
        maxReconnectAttempts: 2,
      })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    // Simulate disconnection
    act(() => {
      const ws = mockWebSocket.mock.instances[0] as MockWebSocket
      ws.simulateError()
    })

    // Let it attempt reconnections
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(result.current.reconnectAttempts).toBe(2)
    expect(result.current.error?.message).toContain('failed after 2 attempts')
  })

  it('should allow manual disconnect', async () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost:3000/ws' })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    act(() => {
      result.current.disconnect()
    })

    expect(result.current.isConnected).toBe(false)
    expect(result.current.reconnectAttempts).toBe(0)
  })

  it('should allow manual reconnection', async () => {
    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost:3000/ws' })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    // Disconnect
    act(() => {
      result.current.disconnect()
    })

    expect(result.current.isConnected).toBe(false)

    // Reconnect
    act(() => {
      result.current.reconnect()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })

    expect(result.current.isConnected).toBe(true)
  })
})
