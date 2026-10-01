"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { getToken } from "@/lib/auth"
import { fetchUnreadCount, type NotificationItem } from "@/lib/notificationsApi"
import { useWebSocket } from "./use-websocket"

interface IncomingNotification {
  id: string
  title: string
  body: string
  notificationType: string
  createdAt: string
}

const MAX_RECONNECT_ATTEMPTS = 5
const BASE_DELAY = 1000

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const wsUrl = useMemo(() => {
    if (typeof window === "undefined") return ""
    const token = getToken()
    if (!token) return ""
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const host = process.env.NEXT_PUBLIC_API_URL
      ? process.env.NEXT_PUBLIC_API_URL.replace(/^https?/, "ws").replace(/\/api$/, "")
      : typeof window !== "undefined" ? `${protocol}//${window.location.host}` : ""
    return `${host}/ws/notifications?token=${token}`
  }, [])

  const { isConnected, lastMessage } = useWebSocket({
    url: wsUrl,
    reconnectInterval: BASE_DELAY,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
    enableFallback: false,
  })

  const fetchCount = useCallback(async () => {
    try {
      const r = await fetchUnreadCount()
      setUnreadCount(r.data.unread)
    } catch {
      // ignore polling errors
    }
  }, [])

  // Initial unread count fetch - use setTimeout to avoid synchronous setState
  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchCount()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchCount])

  // Poll fallback when disconnected
  useEffect(() => {
    if (isConnected) return
    const pollTimer = setInterval(fetchCount, 30000)
    return () => clearInterval(pollTimer)
  }, [isConnected, fetchCount])

  // Handle incoming notification messages - use setTimeout to avoid synchronous setState
  useEffect(() => {
    if (!lastMessage) return

    if (lastMessage.type === "notification") {
      const payload = (lastMessage.payload ?? lastMessage.data) as IncomingNotification | undefined
      if (!payload) return

      const newItem: NotificationItem = {
        id: payload.id,
        category: payload.notificationType,
        title: payload.title,
        body: payload.body,
        data: null,
        read: false,
        createdAt: payload.createdAt,
      }

      const timer = setTimeout(() => {
        setNotifications((prev) => [newItem, ...prev])
        setUnreadCount((prev) => prev + 1)
      }, 0)

      return () => clearTimeout(timer)
    }
  }, [lastMessage])

  return {
    notifications,
    unreadCount,
    isConnected,
  }
}
