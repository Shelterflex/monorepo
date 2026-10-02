"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { Bell, CheckCheck, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useUnreadCount } from "@/hooks/use-unread-count"
import { NotificationItemRow } from "./NotificationItem"
import { markAllNotificationsRead } from "@/lib/notificationsApi"
import { isAuthenticated } from "@/lib/auth"

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { totalUnread, notifUnread, msgUnread, notifications, notifConnected, msgConnected } = useUnreadCount()
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  if (!isAuthenticated()) return null

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead()
    } catch {
    }
  }

  const ariaLabel = totalUnread > 0
    ? `Notifications, ${notifUnread} unread notifications and ${msgUnread} unread messages`
    : "Notifications, no unread items"

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className="relative border-3 border-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all min-h-[44px]"
        aria-label={ariaLabel}
      >
        <Bell className="h-4 w-4" />
        {totalUnread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs font-bold flex items-center justify-center">
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 border-3 border-foreground bg-card shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] z-50">
          {/* Connection Status */}
          <div className="flex items-center justify-between p-3 border-b-2 border-foreground/10">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">Notifications</span>
              {notifConnected && msgConnected ? (
                <span className="h-2 w-2 rounded-full bg-green-500" title="Connected" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-yellow-500" title="Fallback mode" />
              )}
            </div>
            {notifUnread > 0 && (
              <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="text-xs gap-1">
                <CheckCheck className="h-3 w-3" />
                Mark all read
              </Button>
            )}
          </div>

          {/* Messages Section */}
          {msgUnread > 0 && (
            <Link
              href="/messages"
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors border-b-2 border-foreground/10"
              onClick={() => setOpen(false)}
            >
              <div className="flex h-8 w-8 items-center justify-center border-2 border-foreground bg-secondary/20">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">Messages</p>
                <p className="text-xs text-muted-foreground">
                  {msgUnread} unread conversation{msgUnread !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex h-6 w-6 shrink-0 items-center justify-center border-2 border-foreground bg-primary text-xs font-bold">
                {msgUnread > 99 ? "99+" : msgUnread}
              </div>
            </Link>
          )}

          {/* Notifications List */}
          <div className="max-h-64 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center px-4">
                <Bell className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No notifications yet</p>
              </div>
            ) : (
              notifications.slice(0, 10).map((n) => (
                <NotificationItemRow key={n.id} {...n} />
              ))
            )}
          </div>

          {/* View All Messages Link */}
          <Link
            href="/messages"
            className="block border-t-2 border-foreground/10 p-3 text-center text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setOpen(false)}
          >
            View all messages
          </Link>
        </div>
      )}
    </div>
  )
}
