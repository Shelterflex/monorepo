"use client";

import { useUnreadCount } from "./use-unread-count";

/**
 * Hook for notification unread count.
 * Polling has been consolidated into the unified useUnreadCount hook (#1771).
 */
export function useNotificationUnread() {
  const { totalUnread } = useUnreadCount();
  return { unread: totalUnread, error: null, refresh: () => {} };
}
