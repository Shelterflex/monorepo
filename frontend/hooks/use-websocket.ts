import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
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
  
  // Update config ref when config changes
  useEffect(() => {
    configRef.current = mergedConfig
  }, [mergedConfig])

  // Fallback polling when WebSocket fails
  const { data: fallbackData, isPolling: isPollingFallback } = usePolling(
    useCallback(async () => {
      // Only poll if WebSocket is disconnected and fallback is enabled
      if (wsRef.current?.readyState === WebSocket.OPEN || !configRef.current.enableFallback) {
        return { data: null, status: 'connected' }
      }
      
      try {
        const response = await fetch(`${configRef.current.url.replace('ws://', 'http://').replace('wss://', 'https://')}/status`)
        const data = await response.json()
        return { data, status: 'polling' }
      } catch (err) {
        throw new Error('Fallback polling failed')
      }
    }, []),
    {
      enabled: !isConnected && mergedConfig.enableFallback,
      initialInterval: mergedConfig.fallbackPollInterval,
      stopOnStatuses: ['connected'],
    }
  )

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return
    }

    setIsConnecting(true)
    setError(null)
    isManualDisconnect.current = false

    try {
      const ws = new WebSocket(configRef.current.url, configRef.current.protocols)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        setIsConnecting(false)
        setError(null)
        setReconnectAttempts(0)
        
        // Clear any pending reconnect timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = null
        }
      }

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data)
          setLastMessage(message)
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err)
        }
      }

      ws.onclose = (event) => {
        setIsConnected(false)
        setIsConnecting(false)
        
        // Don't reconnect if it was a manual disconnect
        if (isManualDisconnect.current) {
          return
        }

        // Attempt to reconnect if we haven't exceeded max attempts
        if (reconnectAttempts < configRef.current.maxReconnectAttempts) {
          setReconnectAttempts(prev => prev + 1)
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connectRef.current?.()
          }, configRef.current.reconnectInterval)
        } else {
          setError(new Error(`WebSocket connection failed after ${configRef.current.maxReconnectAttempts} attempts`))
        }
      }

      ws.onerror = (event) => {
        setError(new Error('WebSocket connection error'))
        setIsConnecting(false)
      }

    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to create WebSocket connection'))
      setIsConnecting(false)
    }
  }, [reconnectAttempts])

  // Update connect ref when connect function changes
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
    setReconnectAttempts(0)
    setError(null)
    disconnect()
    setTimeout(connect, 100)
  }, [disconnect, connect])

  const send = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    } else {
      console.warn('WebSocket is not connected. Message not sent:', message)
    }
  }, [])

  // Initial connection
  useEffect(() => {
    const timer = setTimeout(() => {
      connect()
    }, 0)
    
    return () => {
      clearTimeout(timer)
      disconnect()
    }
  }, [connect, disconnect]) // Only run once on mount

  // Cleanup on unmount
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
