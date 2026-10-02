"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { RefreshCw, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DeadLetterTable } from "@/components/admin/DeadLetterTable"
import { DeadLetterFilters, type DeadLetterFiltersState } from "@/components/admin/DeadLetterFilters"
import {
  fetchDeadLetterItems,
  retryDeadLetterItem,
  bulkRetryDeadLetters,
  dismissDeadLetterItem,
  type DeadLetterItem,
} from "@/lib/outboxAdminApi"
import { handleError, showSuccessToast } from "@/lib/toast"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog"

const DEFAULT_FILTERS: DeadLetterFiltersState = { eventType: "", dateFrom: "", dateTo: "" }

function OutboxPageContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Sync state with URL params
  const paramPage = parseInt(searchParams.get("page") || "1", 10)
  const paramEventType = searchParams.get("eventType") || ""
  const paramDateFrom = searchParams.get("dateFrom") || ""
  const paramDateTo = searchParams.get("dateTo") || ""

  const [items, setItems] = useState<DeadLetterItem[]>([])
  const [loading, setLoading] = useState(true)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set())
  const [bulkRetrying, setBulkRetrying] = useState(false)

  // Dialog triggers
  const [retryTarget, setRetryTarget] = useState<string | null>(null)
  const [dismissTarget, setDismissTarget] = useState<string | null>(null)
  const [bulkRetryConfirm, setBulkRetryConfirm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchDeadLetterItems({
        page: paramPage,
        pageSize: 20,
        eventType: paramEventType || undefined,
        dateFrom: paramDateFrom || undefined,
        dateTo: paramDateTo || undefined,
      })
      setItems(result.items)
      setTotalPages(result.pagination.totalPages)
      setTotal(result.pagination.total)
    } catch (err) {
      handleError(err, "Failed to load dead-letter records")
    } finally {
      setLoading(false)
    }
  }, [paramPage, paramEventType, paramDateFrom, paramDateTo])

  useEffect(() => {
    void load()
  }, [load])

  const updateQueryParams = useCallback((newParams: Partial<DeadLetterFiltersState> & { page?: number }) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()))
    
    if (newParams.page !== undefined) {
      current.set("page", String(newParams.page))
    }
    if (newParams.eventType !== undefined) {
      if (newParams.eventType) current.set("eventType", newParams.eventType)
      else current.delete("eventType")
    }
    if (newParams.dateFrom !== undefined) {
      if (newParams.dateFrom) current.set("dateFrom", newParams.dateFrom)
      else current.delete("dateFrom")
    }
    if (newParams.dateTo !== undefined) {
      if (newParams.dateTo) current.set("dateTo", newParams.dateTo)
      else current.delete("dateTo")
    }

    const search = current.toString()
    const query = search ? `?${search}` : ""
    router.push(`${pathname}${query}`)
  }, [searchParams, router, pathname])

  const handleRetry = async (id: string) => {
    setRetryTarget(null)
    if (retryingIds.has(id)) return // guard against double click
    setRetryingIds((prev) => new Set(prev).add(id))
    try {
      const result = await retryDeadLetterItem(id)
      showSuccessToast(result.message)
      await load()
    } catch (err) {
      handleError(err, "Failed to retry record")
    } finally {
      setRetryingIds((prev) => {
        const n = new Set(prev)
        n.delete(id)
        return n
      })
    }
  }

  const handleBulkRetry = async () => {
    setBulkRetryConfirm(false)
    if (!paramEventType || bulkRetrying) return
    setBulkRetrying(true)
    try {
      const result = await bulkRetryDeadLetters(paramEventType)
      showSuccessToast(result.message)
      await load()
    } catch (err) {
      handleError(err, "Failed to bulk retry")
    } finally {
      setBulkRetrying(false)
    }
  }

  const handleDismiss = async (id: string) => {
    setDismissTarget(null)
    if (dismissingIds.has(id)) return
    setDismissingIds((prev) => new Set(prev).add(id))
    try {
      const result = await dismissDeadLetterItem(id)
      showSuccessToast(result.message)
      setItems((prev) => prev.filter((i) => i.id !== id))
    } catch (err) {
      handleError(err, "Failed to dismiss record")
    } finally {
      setDismissingIds((prev) => {
        const n = new Set(prev)
        n.delete(id)
        return n
      })
    }
  }

  const currentFilters: DeadLetterFiltersState = {
    eventType: paramEventType,
    dateFrom: paramDateFrom,
    dateTo: paramDateTo,
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-3 border-foreground bg-card p-4 md:p-6">
        <div className="container mx-auto">
          <h1 className="text-2xl font-black md:text-3xl">Dead-Letter Queue</h1>
          <p className="text-sm text-muted-foreground mt-2">
            View and retry failed outbox events that exceeded max retry attempts
          </p>
        </div>
      </header>

      <main id="main-content" className="container mx-auto px-4 py-8">
        <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <DeadLetterFilters
              filters={currentFilters}
              onChange={(f) => {
                updateQueryParams({ ...f, page: 1 })
              }}
              onReset={() => {
                updateQueryParams({ eventType: "", dateFrom: "", dateTo: "", page: 1 })
              }}
            />
            <div className="flex items-center gap-2">
              {paramEventType && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setBulkRetryConfirm(true)}
                  disabled={bulkRetrying}
                  className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
                >
                  {bulkRetrying ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-4 w-4" />
                  )}
                  Bulk Retry ({paramEventType})
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void load()}
                disabled={loading}
                aria-label="Refresh outbox records"
                className="border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <DeadLetterTable
            items={items}
            loading={loading}
            page={paramPage}
            totalPages={totalPages}
            total={total}
            retryingIds={retryingIds}
            dismissingIds={dismissingIds}
            onRetry={(id) => setRetryTarget(id)}
            onDismiss={(id) => setDismissTarget(id)}
            onPageChange={(p) => updateQueryParams({ page: p })}
          />
        </Card>
      </main>

      {/* Retry Confirmation Dialog */}
      <AlertDialog open={retryTarget !== null} onOpenChange={(open) => !open && setRetryTarget(null)}>
        <AlertDialogContent className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black">Retry Event Execution?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Are you sure you want to retry this outbox event? The service will attempt to process the event again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel className="border-3 border-foreground font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => retryTarget && handleRetry(retryTarget)}
              className="border-3 border-foreground bg-primary font-bold text-primary-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:bg-primary/95"
            >
              Confirm Retry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dismiss Confirmation Dialog */}
      <AlertDialog open={dismissTarget !== null} onOpenChange={(open) => !open && setDismissTarget(null)}>
        <AlertDialogContent className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black text-destructive">Dismiss Dead-Letter Event?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Are you sure you want to permanently dismiss this dead-letter record? This action cannot be undone and will stop any further automated retry cycles.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel className="border-3 border-foreground font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => dismissTarget && handleDismiss(dismissTarget)}
              className="border-3 border-foreground bg-destructive font-bold text-destructive-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:bg-destructive/90"
            >
              Dismiss
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Retry Confirmation Dialog */}
      <AlertDialog open={bulkRetryConfirm} onOpenChange={setBulkRetryConfirm}>
        <AlertDialogContent className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black text-primary">Bulk Retry Events?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Are you sure you want to bulk retry all dead-lettered events of type <span className="font-mono font-bold text-foreground">"{paramEventType}"</span>? This will re-queue all matching events.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel className="border-3 border-foreground font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkRetry}
              className="border-3 border-foreground bg-primary font-bold text-primary-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:bg-primary/95"
            >
              Confirm Bulk Retry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default function AdminOutboxPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="font-mono text-xs text-muted-foreground">Loading dead-letter interface...</p>
          </div>
        </div>
      }
    >
      <OutboxPageContent />
    </Suspense>
  )
}
