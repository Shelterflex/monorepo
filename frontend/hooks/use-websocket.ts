import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePolling } from './use-polling'

export interface WebSocketMessage {
  type: 'transaction_status' | 'staking_reward' | 'system_notification'
  data: any
  timestamp: string
}

export interface WebSocketConfig {
  url: string
  protocols?: string[]
  reconnectInterval?: number
  maxReconnectAttempts?: number
  enableFallback?: boolean
  fallbackPollInterval?: number
}

export interface WebSocketResult {
  isConnected: boolean
  isConnecting: boolean
  error: Error | null
  lastMessage: WebSocketMessage | null
  reconnectAttempts: number
  send: (message: any) => void
  disconnect: () => void
  reconnect: () => void
}

const DEFAULT_CONFIG: Required<Omit<WebSocketConfig, 'url'>> = {
  protocols: [],
  reconnectInterval: 3000,
  maxReconnectAttempts: 10,
  enableFallback: true,
  fallbackPollInterval: 5000,
}

export function useWebSocket(config: WebSocketConfig): WebSocketResult {
  const mergedConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config])

  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isManualDisconnect = useRef(false)
  const connectRef = useRef<(() => void) | null>(null)
  const configRef = useRef(mergedConfig)

  useEffect(() => {
    configRef.current = mergedConfig
  }, [mergedConfig])

  usePolling(
    useCallback(async () => {
      if (wsRef.current?.readyState === WebSocket.OPEN || !configRef.current.enableFallback) {
        return { data: null, status: 'connected' }
      }

      try {
        const response = await fetch(
          `${configRef.current.url
            .replace('ws://', 'http://')
            .replace('wss://', 'https://')}/status`,
        )
        const data = await response.json()
        return { data, status: 'polling' }
      } catch {
        throw new Error('Fallback polling failed')
      }
    }, []),
    {
      enabled: !isConnected && mergedConfig.enableFallback,
      initialInterval: mergedConfig.fallbackPollInterval,
      stopOnStatuses: ['connected'],
    },
  )

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return
    }

    setIsConnecting(true)
    setError(null)
    isManualDisconnect.current = false

    try {
      const protocols = configRef.current.protocols.length
        ? configRef.current.protocols
        : undefined
      const ws = new WebSocket(configRef.current.url, protocols)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        setIsConnecting(false)
        setError(null)
        setReconnectAttempts(0)

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = null
        }
      }

      ws.onmessage = (event) => {
        try {
          setLastMessage(JSON.parse(event.data) as WebSocketMessage)
        } catch (nextError) {
          console.error('Failed to parse WebSocket message:', nextError)
        }
      }

      ws.onclose = () => {
        setIsConnected(false)
        setIsConnecting(false)

        if (isManualDisconnect.current) {
          return
        }

        setReconnectAttempts((previous) => {
          const nextAttempt = previous + 1

          if (nextAttempt > configRef.current.maxReconnectAttempts) {
            setError(
              new Error(
                `WebSocket connection failed after ${configRef.current.maxReconnectAttempts} attempts`,
              ),
            )
            return previous
          }

          reconnectTimeoutRef.current = setTimeout(() => {
            connectRef.current?.()
          }, configRef.current.reconnectInterval)

          return nextAttempt
        })
      }

      ws.onerror = () => {
        setError(new Error('WebSocket connection error'))
        setIsConnecting(false)
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError
          : new Error('Failed to create WebSocket connection'),
      )
      setIsConnecting(false)
    }
  }, [])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const disconnect = useCallback(() => {
    isManualDisconnect.current = true

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setIsConnected(false)
    setIsConnecting(false)
    setReconnectAttempts(0)
  }, [])

  const reconnect = useCallback(() => {
    disconnect()
    setError(null)
    connect()
  }, [connect, disconnect])

  const send = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    } else {
      console.warn('WebSocket is not connected. Message not sent:', message)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  return {
    isConnected,
    isConnecting,
    error,
    lastMessage,
    reconnectAttempts,
    send,
    disconnect,
    reconnect,
  }
}
