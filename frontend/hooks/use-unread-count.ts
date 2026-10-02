"use client"

import { useNotifications } from "./useNotifications"
import { useUnreadMessageCount } from "./useUnreadMessageCount"

export interface UseUnreadCountResult {
  unread: number
  totalUnread: number
  notifUnread: number
  msgUnread: number
  notifications: ReturnType<typeof useNotifications>["notifications"]
  notifConnected: boolean
  msgConnected: boolean
  isConnected: boolean
}

/**
 * Unified unread-count hook that consolidates notifications and messages
 * into a single source of truth for all header and navigation badges.
 */
export function useUnreadCount(): UseUnreadCountResult {
  const { unreadCount: notifUnread, notifications, isConnected: notifConnected } = useNotifications()
  const { unreadCount: msgUnread, isConnected: msgConnected } = useUnreadMessageCount()

  const totalUnread = notifUnread + msgUnread

  return {
    unread: totalUnread,
    totalUnread,
    notifUnread,
    msgUnread,
    notifications,
    notifConnected,
    msgConnected,
    isConnected: notifConnected && msgConnected,
  }
}
