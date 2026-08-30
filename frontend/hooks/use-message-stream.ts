"use client"

import { useEffect, useRef, useCallback } from "react"
import useAuthStore from "@/store/useAuthStore"

export interface StreamMessage {
  type: "new_message" | "read_receipt"
  conversationId: string
  payload: Record<string, unknown>
}

interface UseMessageStreamOptions {
  onMessage?: (msg: StreamMessage) => void
  onError?: (err: Error) => void
  onConnected?: () => void
  enabled?: boolean
}

const BASE_RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 30_000
const BACKOFF_MULTIPLIER = 2

export function useMessageStream({
  onMessage,
  onError,
  onConnected,
  enabled = true,
}: UseMessageStreamOptions) {
  const token = useAuthStore((s) => s.token)
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const reconnectAttemptRef = useRef(0)
  const lastEventIdRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const connectRef = useRef<() => void>(() => {})

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(BACKOFF_MULTIPLIER, reconnectAttemptRef.current),
      MAX_RECONNECT_DELAY,
    )
    reconnectAttemptRef.current += 1

    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) connectRef.current()
    }, delay)

    onError?.(new Error("SSE connection lost, reconnecting..."))
  }, [onError])

  const connect = useCallback(() => {
    if (!token || !enabled) return

    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
    const params = new URLSearchParams()
    params.set("token", token)
    if (lastEventIdRef.current) params.set("lastEventId", lastEventIdRef.current)
    const url = `${baseUrl}/api/v1/messaging/stream?${params.toString()}`

    const es = new EventSource(url)

    eventSourceRef.current = es

    es.addEventListener("connected", () => {
      reconnectAttemptRef.current = 0
      onConnected?.()
    })

    es.addEventListener("new_message", (e) => {
      lastEventIdRef.current = e.lastEventId
      try {
        const data = JSON.parse(e.data) as StreamMessage
        onMessage?.(data)
      } catch {
        void 0
      }
    })

    es.addEventListener("read_receipt", (e) => {
      lastEventIdRef.current = e.lastEventId
      try {
        const data = JSON.parse(e.data) as StreamMessage
        onMessage?.(data)
      } catch {
        void 0
      }
    })

    es.addEventListener("error", () => {
      es.close()
      scheduleReconnect()
    })
  }, [token, enabled, onMessage, onConnected, scheduleReconnect])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (eventSourceRef.current) eventSourceRef.current.close()
    }
  }, [connect])

  const close = useCallback(() => {
    mountedRef.current = false
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    if (eventSourceRef.current) eventSourceRef.current.close()
  }, [])

  return { close, reconnect: connect }
}
