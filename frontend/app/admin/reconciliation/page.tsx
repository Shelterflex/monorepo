"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  RefreshCw,
  Loader2,
  FileText,
  ArrowRightLeft,
  Inbox,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getOutboxItems, retryOutboxItem, retryAllOutboxItems, type OutboxItem } from "@/lib/reconciliationApi";
import { handleError, showSuccessToast } from "@/lib/toast";
import { parseBackendError, type ParsedError } from "@/lib/errors";
import { apiGet, apiPost } from "@/lib/apiClient";

type LoadState<T> =
  | { type: "loading" }
  | { type: "error"; message: string; parsedError?: ParsedError }
  | { type: "success"; data: T };

type OutboxStatus = "pending" | "sent" | "failed" | "all";

interface Mismatch {
  id: string;
  status: string;
  mismatchClass: string;
  createdAt: string;
}

interface AgingReport {
  data: Array<{ class: string; status: string; count: number; oldest: string }>;
}

const ITEMS_PER_PAGE = 10;

function ErrorPanel({ 
  error, 
  onRetry, 
  entityName = "items" 
}: { 
  readonly error: ParsedError | string; 
  readonly onRetry: () => void; 
  readonly entityName?: string;
}) {
  const userMessage = typeof error === 'string' ? error : error.userMessage;
  const code = typeof error === 'string' ? 'ERROR' : error.code;
  
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
      <AlertCircle className="h-12 w-12 text-destructive mb-4" />
      <p className="text-sm font-medium text-destructive mb-2">
        {userMessage}
      </p>
      {code !== 'UNKNOWN_ERROR' && code !== 'ERROR' && (
        <p className="text-xs text-muted-foreground mb-4">
          Error code: {code}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-05 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
      >
        <RefreshCw className="mr-2 h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}

function EmptyState({ 
  icon: Icon, 
  title, 
  description 
}: { 
  readonly icon: React.ComponentType<{ className?: string }>; 
  readonly title: string; 
  readonly description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
      <Icon className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
      <p className="text-sm font-medium text-muted-foreground mb-2">
        {title}
      </p>
      <p className="text-xs text-muted-foreground max-w-xs">
        {description}
      </p>
    </div>
  );
}

function SkeletonList({ count = 3 }: { readonly count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
}: {
  readonly currentPage: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
  readonly totalItems: number;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-4 border-t-2 border-foreground">
      <p className="text-sm text-muted-foreground">
        Showing page {currentPage} of {totalPages} ({totalItems} total)
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50 disabled:shadow-none disabled:translate-none"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-bold px-3 py-2 border-3 border-foreground bg-card min-w-[3rem] text-center">
          {currentPage}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50 disabled:shadow-none disabled:translate-none"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "sent":
      return "default";
    case "pending":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "sent":
      return <CheckCircle2 className="h-4 w-4" />;
    case "pending":
      return <Clock className="h-4 w-4" />;
    case "failed":
      return <XCircle className="h-4 w-4" />;
    default:
      return <AlertCircle className="h-4 w-4" />;
  }
}

export default function ReconciliationDashboard() {
  const [activeTab, setActiveTab] = useState<"deposits" | "conversions" | "outbox" | "mismatches" | "aging">("outbox");
  const [outboxState, setOutboxState] = useState<LoadState<OutboxItem[]>>({ type: "loading" });
  const [outboxStatusFilter, setOutboxStatusFilter] = useState<OutboxStatus>("all");
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [mismatchesState, setMismatchesState] = useState<LoadState<Mismatch[]>>({ type: "loading" });
  const [agingState, setAgingState] = useState<LoadState<AgingReport>>({ type: "loading" });
  const [closingId, setClosingId] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  const fetchOutboxItems = useCallback(async () => {
    setOutboxState({ type: "loading" });
    try {
      const response = await getOutboxItems({
        status: outboxStatusFilter === "all" ? undefined : outboxStatusFilter,
        limit: 100,
      });
      setOutboxState({ type: "success", data: response.items });
      setTotalItems(response.total);
    } catch (err) {
      handleError(err, "Failed to load outbox items");
      const parsedError = parseBackendError(err, "Failed to load outbox items");
      setOutboxState({
        type: "error",
        message: parsedError.message,
        parsedError,
      });
    }
  }, [outboxStatusFilter]);

  const fetchMismatches = useCallback(async () => {
    setMismatchesState({ type: "loading" });
    try {
      const response = await apiGet<{ data: Mismatch[] }>("/admin/ledger-reconciliation/mismatches");
      setMismatchesState({ type: "success", data: response.data });
    } catch (err) {
      handleError(err, "Failed to load mismatches");
      const parsedError = parseBackendError(err, "Failed to load mismatches");
      setMismatchesState({
        type: "error",
        message: parsedError.message,
        parsedError,
      });
    }
  }, []);

  const fetchAging = useCallback(async () => {
    setAgingState({ type: "loading" });
    try {
      const response = await apiGet<AgingReport>("/admin/ledger-reconciliation/aging");
      setAgingState({ type: "success", data: response });
    } catch (err) {
      handleError(err, "Failed to load aging report");
      const parsedError = parseBackendError(err, "Failed to load aging report");
      setAgingState({
        type: "error",
        message: parsedError.message,
        parsedError,
      });
    }
  }, []);

  useEffect(() => {
    if (activeTab === "outbox") {
      fetchOutboxItems();
    } else if (activeTab === "mismatches") {
      fetchMismatches();
    } else if (activeTab === "aging") {
      fetchAging();
    }
  }, [activeTab, fetchOutboxItems, fetchMismatches, fetchAging]);

  const handleRetryItem = async (id: string) => {
    setRetryingIds((prev) => new Set(prev).add(id));
    try {
      const result = await retryOutboxItem(id);
      showSuccessToast(result.message);
      await fetchOutboxItems();
    } catch (err) {
      handleError(err, "Failed to retry outbox item");
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleRetryAll = async () => {
    setRetryingIds(new Set(["all"]));
    try {
      const result = await retryAllOutboxItems();
      showSuccessToast(result.message);
      await fetchOutboxItems();
    } catch (err) {
      handleError(err, "Failed to retry all outbox items");
    } finally {
      setRetryingIds(new Set());
    }
  };

  const handleCloseMismatch = async () => {
    if (!closingId) return;
    try {
      await apiPost(`/admin/ledger-reconciliation/mismatches/${encodeURIComponent(closingId)}/close`, {});
      showSuccessToast("Mismatch closed successfully");
      setShowCloseConfirm(false);
      setClosingId(null);
      await fetchMismatches();
    } catch (err) {
      handleError(err, "Failed to close mismatch");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-3 border-foreground bg-card p-4 md:p-6">
        <div className="container mx-auto">
          <h1 className="text-2xl font-black md:text-3xl">Reconciliation Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Monitor pending deposits, conversions, and outbox items
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Custom Tabs */}
        <nav aria-label="Reconciliation sections">
          <div className="mb-6 flex flex-wrap gap-2 md:gap-4" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === "deposits"}
            onClick={() => setActiveTab("deposits")}
            className={`flex items-center gap-2 border-3 border-foreground px-3 py-2 text-sm font-bold transition-all md:px-6 md:py-3 md:text-base ${
              activeTab === "deposits"
                ? "bg-foreground text-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                : "bg-card hover:bg-muted"
            }`}
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Deposits
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "conversions"}
            onClick={() => setActiveTab("conversions")}
            className={`flex items-center gap-2 border-3 border-foreground px-3 py-2 text-sm font-bold transition-all md:px-6 md:py-3 md:text-base ${
              activeTab === "conversions"
                ? "bg-foreground text-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                : "bg-card hover:bg-muted"
            }`}
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
            Conversions
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "outbox"}
            onClick={() => setActiveTab("outbox")}
            className={`flex items-center gap-2 border-3 border-foreground px-3 py-2 text-sm font-bold transition-all md:px-6 md:py-3 md:text-base ${
              activeTab === "outbox"
                ? "bg-foreground text-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                : "bg-card hover:bg-muted"
            }`}
          >
            <Inbox className="h-4 w-4" aria-hidden="true" />
            Outbox
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "mismatches"}
            onClick={() => setActiveTab("mismatches")}
            className={`flex items-center gap-2 border-3 border-foreground px-3 py-2 text-sm font-bold transition-all md:px-6 md:py-3 md:text-base ${
              activeTab === "mismatches"
                ? "bg-foreground text-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                : "bg-card hover:bg-muted"
            }`}
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Mismatches
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "aging"}
            onClick={() => setActiveTab("aging")}
            className={`flex items-center gap-2 border-3 border-foreground px-3 py-2 text-sm font-bold transition-all md:px-6 md:py-3 md:text-base ${
              activeTab === "aging"
                ? "bg-foreground text-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                : "bg-card hover:bg-muted"
            }`}
          >
            <Clock className="h-4 w-4" aria-hidden="true" />
            Aging
          </button>
          </div>
        </nav>

        {/* Deposits Tab */}
        {activeTab === "deposits" && (
          <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <div className="mb-4">
              <h2 className="text-xl font-black mb-2">Deposits</h2>
              <p className="text-sm text-muted-foreground">
                View pending, failed, and reversed deposits
              </p>
            </div>
            <EmptyState
              icon={FileText}
              title="No deposits available"
              description="Deposit reconciliation will be available when the backend API is implemented. This tab will show pending, failed, and reversed deposits."
            />
          </Card>
        )}

        {/* Conversions Tab */}
        {activeTab === "conversions" && (
          <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <div className="mb-4">
              <h2 className="text-xl font-black mb-2">Conversions</h2>
              <p className="text-sm text-muted-foreground">
                View pending and failed NGN to USDC conversions
              </p>
            </div>
            <EmptyState
              icon={ArrowRightLeft}
              title="No conversions available"
              description="Conversion reconciliation will be available when the backend API is implemented. This tab will show pending and failed NGN to USDC conversions."
            />
          </Card>
        )}

        {/* Mismatches Tab */}
        {activeTab === "mismatches" && (
          <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-black mb-2">Ledger Mismatches</h2>
                <p className="text-sm text-muted-foreground">
                  Discrepancies between internal ledger and provider records
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchMismatches}
                aria-label="Refresh mismatches"
                className="border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {mismatchesState.type === "loading" && <SkeletonList count={3} />}
            {mismatchesState.type === "error" && (
              <ErrorPanel
                error={mismatchesState.parsedError || mismatchesState.message}
                onRetry={fetchMismatches}
                entityName="mismatches"
              />
            )}
            {mismatchesState.type === "success" && (
              <>
                {mismatchesState.data.length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="No mismatches found"
                    description="All ledger records match provider data"
                  />
                ) : (
                  <div className="space-y-4">
                    {mismatchesState.data.map((item) => (
                      <Card
                        key={item.id}
                        className="border-3 border-foreground bg-card p-4 shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="px-2 py-1 border-2 border-foreground bg-accent font-bold text-xs">
                                {item.mismatchClass}
                              </div>
                              <div className="px-2 py-1 border-2 border-foreground bg-muted font-mono text-xs font-bold">
                                {item.status}
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              ID: <code className="bg-muted px-1.5 py-0.5 rounded">{item.id.slice(0, 12)}...</code>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Created: {new Date(item.createdAt).toLocaleString()}
                            </div>
                          </div>
                          {item.status !== "closed" && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setClosingId(item.id);
                                setShowCloseConfirm(true);
                              }}
                              className="border-3 border-destructive font-bold"
                            >
                              Close
                            </Button>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            )}
            {showCloseConfirm && closingId && (
              <div className="mt-6 border-3 border-destructive bg-destructive/10 p-6">
                <h3 className="font-bold text-lg mb-3">Confirm mismatch closure</h3>
                <p className="text-sm mb-4">Are you sure you want to manually close this mismatch?</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCloseConfirm(false);
                      setClosingId(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void handleCloseMismatch()}
                    className="border-2 border-destructive font-bold"
                  >
                    Confirm
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Aging Tab */}
        {activeTab === "aging" && (
          <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-black mb-2">Mismatch Aging</h2>
                <p className="text-sm text-muted-foreground">
                  SLA aging report for open mismatches
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchAging}
                aria-label="Refresh aging report"
                className="border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {agingState.type === "loading" && <SkeletonList count={3} />}
            {agingState.type === "error" && (
              <ErrorPanel
                error={agingState.parsedError || agingState.message}
                onRetry={fetchAging}
                entityName="aging report"
              />
            )}
            {agingState.type === "success" && (
              <>
                {agingState.data.data.length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="No aging data"
                    description="No open mismatches to report"
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b-3 border-foreground">
                          <th className="text-left px-4 py-2 font-bold">Class</th>
                          <th className="text-left px-4 py-2 font-bold">Status</th>
                          <th className="text-right px-4 py-2 font-bold">Count</th>
                          <th className="text-left px-4 py-2 font-bold text-xs">Oldest</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agingState.data.data.map((row, idx) => (
                          <tr key={idx} className="border-b-2 border-foreground/20">
                            <td className="px-4 py-2 font-mono">{row.class}</td>
                            <td className="px-4 py-2">
                              <span className="px-2 py-1 border border-foreground text-xs font-bold bg-muted">
                                {row.status}
                              </span>
                            </td>
                            <td className="text-right px-4 py-2 font-bold">{row.count}</td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">
                              {new Date(row.oldest).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </Card>
        )}

        {/* Outbox Tab */}
        {activeTab === "outbox" && (
          <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-black mb-2">Outbox Items</h2>
                <p className="text-sm text-muted-foreground">
                  Monitor blockchain transaction receipts and retry failed items
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="border-3 border-foreground bg-card p-2">
                  <p className="text-xs font-bold mb-2 block" id="outbox-filter-label">Filter Status</p>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="outbox-filter-label">
                    {(["all", "pending", "sent", "failed"] as OutboxStatus[]).map((status) => (
                      <button
                        key={status}
                        onClick={() => setOutboxStatusFilter(status)}
                        aria-pressed={outboxStatusFilter === status}
                        className={`border-2 border-foreground p-2 text-xs font-bold transition-all ${
                          outboxStatusFilter === status
                            ? "bg-primary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                            : "bg-card"
                        }`}
                      >
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchOutboxItems}
                  aria-label="Refresh outbox items"
                  className="border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                </Button>
                {outboxStatusFilter === "failed" && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleRetryAll}
                    disabled={retryingIds.has("all")}
                    className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
                  >
                    {retryingIds.has("all") ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Retry All
                  </Button>
                )}
              </div>
            </div>
                {outboxState.type === "loading" && <SkeletonList count={3} />}

                {outboxState.type === "error" && outboxState.parsedError && (
                  <ErrorPanel
                    error={outboxState.parsedError}
                    onRetry={fetchOutboxItems}
                    entityName="outbox items"
                  />
                )}

                {outboxState.type === "error" && !outboxState.parsedError && (
                  <ErrorPanel
                    error={outboxState.message}
                    onRetry={fetchOutboxItems}
                    entityName="outbox items"
                  />
                )}

                {outboxState.type === "success" && (
                  <>
                    {outboxState.data.length === 0 ? (
                      <EmptyState
                        icon={Inbox}
                        title="No outbox items found"
                        description={
                          outboxStatusFilter !== "all"
                            ? `No items with status "${outboxStatusFilter}"`
                            : "No outbox items in the system"
                        }
                      />
                    ) : (
                      <div className="space-y-4">
                        <div className="text-sm text-muted-foreground">
                          Showing {outboxState.data.length} item{outboxState.data.length !== 1 ? "s" : ""} of {totalItems}
                        </div>
                        {outboxState.data.map((item) => (
                          <Card
                            key={item.id}
                            className="border-3 border-foreground bg-card p-4 shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:bg-muted"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <div
                                    className={`px-2 py-1 border-2 border-foreground font-bold text-xs flex items-center gap-1 ${
                                      item.status === "sent"
                                        ? "bg-secondary"
                                        : item.status === "pending"
                                        ? "bg-accent"
                                        : "bg-destructive text-destructive-foreground"
                                    }`}
                                  >
                                    {getStatusIcon(item.status)}
                                    {item.status}
                                  </div>
                                  <div className="px-2 py-1 border-2 border-foreground bg-muted font-mono text-xs font-bold">
                                    {item.txType}
                                  </div>
                                </div>
                                  <div className="space-y-1 text-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">ID:</span>
                                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                        {item.id.slice(0, 8)}...
                                      </code>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">Tx ID:</span>
                                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                                        {item.txId.slice(0, 16)}...
                                      </code>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">External Ref:</span>
                                      <span className="text-xs text-muted-foreground">
                                        {item.externalRef}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                      <span>Created: {formatDate(item.createdAt)}</span>
                                      <span>•</span>
                                      <span>Attempts: {item.attempts}</span>
                                    </div>
                                    {item.lastError && (
                                      <div className="mt-2 border-3 border-destructive bg-destructive/10 p-2">
                                        <p className="text-xs font-bold text-destructive">Error:</p>
                                        <p className="text-xs text-destructive">{item.lastError}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {item.status === "failed" && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleRetryItem(item.id)}
                                    disabled={retryingIds.has(item.id)}
                                    className="border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
                                  >
                                    {retryingIds.has(item.id) ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <RefreshCw className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                              </div>
                            </Card>
                        ))}
                        <PaginationControls
                          currentPage={currentPage}
                          totalPages={totalPages}
                          onPageChange={setCurrentPage}
                          totalItems={totalItems}
                        />
                      </div>
                    )}
                  </>
                )}
          </Card>
        )}
      </main>
    </div>
  );
}
