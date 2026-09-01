"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "@/components/dashboard-header";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  fetchUnreadCount,
  type NotificationItem,
} from "@/lib/notificationsApi";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date";

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "deal_update", label: "Deals" },
  { value: "payment_due", label: "Payments" },
  { value: "kyc_update", label: "KYC" },
  { value: "dispute_update", label: "Disputes" },
  { value: "reward_validated", label: "Rewards" },
  { value: "inspection_assigned", label: "Inspections" },
];

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [markAllLoading, setMarkAllLoading] = useState(false);
  const liveRegionRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (cursor?: string, filterValue?: string) => {
    setLoading(true);
    setErr(null);
    try {
      const params: Record<string, any> = { cursor, limit: 20 };
      if (filterValue === "unread") {
        params.read = false;
      } else if (filterValue && filterValue !== "") {
        params.category = filterValue;
      }
      const r = await fetchNotifications(params);
      setItems((prev) => (cursor ? [...prev, ...r.data.items] : r.data.items));
      setNextCursor(r.data.nextCursor);

      // Fetch and reconcile unread count
      const unreadResult = await fetchUnreadCount();
      setUnreadCount(unreadResult.data.unread);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void load(undefined, filter);
  }, [filter, load]);

  const onRead = async (id: string) => {
    const previousState = items.find((i) => i.id === id);
    if (!previousState) return;

    // Optimistic update
    setOptimistic((o) => new Set(o).add(id));
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, read: true } : i)),
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    // Announce to screen readers
    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = "Notification marked as read";
    }

    try {
      await markNotificationRead(id);
    } catch {
      // Rollback on failure
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, read: previousState.read } : i)),
      );
      setUnreadCount((prev) => prev + 1);
      setOptimistic((o) => {
        const n = new Set(o);
        n.delete(id);
        return n;
      });

      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = "Failed to mark notification as read";
      }
    }
  };

  const onReadAll = async () => {
    const previousItems = [...items];
    setMarkAllLoading(true);

    // Optimistic update
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    setUnreadCount(0);

    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = "All notifications marked as read";
    }

    try {
      await markAllNotificationsRead();
    } catch {
      // Rollback on failure
      setItems(previousItems);
      setUnreadCount(previousItems.filter((i) => !i.read).length);
      void load();

      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = "Failed to mark all notifications as read";
      }
    } finally {
      setMarkAllLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <main className="container mx-auto max-w-2xl px-4 pt-24 pb-12">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/dashboard/tenant"
            className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Link>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void onReadAll()}
            disabled={markAllLoading || unreadCount === 0}
            aria-label={`Mark all ${unreadCount} notifications as read`}
          >
            {markAllLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="h-4 w-4" />
            )}
            Mark all read
          </Button>
        </div>
        <h1 className="mb-6 font-mono text-2xl font-black">Notifications</h1>

        {/* Filter Tabs */}
        <div className="mb-6 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Notification filters">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setFilter(cat.value)}
              role="tab"
              aria-selected={filter === cat.value}
              aria-controls="notifications-list"
              className={cn(
                "whitespace-nowrap px-3 py-2 text-sm font-bold border-2 transition-colors",
                filter === cat.value
                  ? "border-foreground bg-primary text-foreground"
                  : "border-foreground bg-transparent text-foreground hover:bg-primary/20"
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {err && (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {err}
          </p>
        )}

        {/* Live region for screen reader announcements */}
        <div ref={liveRegionRef} aria-live="polite" aria-atomic="true" className="sr-only" />

        <ul
          className="space-y-2"
          role="list"
          aria-label="Notifications"
          id="notifications-list"
        >
          {items.map((n) => (
            <li
              key={n.id}
              className={cn(
                "rounded border-2 border-foreground p-4 shadow-[2px_2px_0_0_#1a1a1a] transition-opacity",
                !n.read && !optimistic.has(n.id) && "bg-primary/5",
              )}
              aria-labelledby={`notification-title-${n.id}`}
              aria-describedby={`notification-body-${n.id}`}
            >
              <div className="flex justify-between gap-2">
                <div className="flex-1">
                  <p className="text-xs font-mono uppercase text-muted-foreground">
                    {n.category}
                  </p>
                  <h2
                    id={`notification-title-${n.id}`}
                    className="font-bold"
                  >
                    {n.title}
                  </h2>
                  <p
                    id={`notification-body-${n.id}`}
                    className="mt-1 text-sm text-muted-foreground"
                  >
                    {n.body}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatDateTime(n.createdAt)}
                  </p>
                </div>
                {!n.read && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void onRead(n.id)}
                    aria-label={`Mark notification as read: ${n.title}`}
                  >
                    Mark read
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {nextCursor && (
          <div className="mt-6 flex justify-center">
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => void load(nextCursor)}
              aria-label="Load more notifications"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading…
                </>
              ) : (
                "Load more"
              )}
            </Button>
          </div>
        )}
        {!loading && items.length === 0 && !err && (
          <p className="text-center text-muted-foreground">No notifications yet.</p>
        )}
      </main>
    </div>
  );
}
