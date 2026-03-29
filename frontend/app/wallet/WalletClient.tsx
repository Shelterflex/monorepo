"use client";

import { useCallback, useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpRight,
  Info,
  RefreshCw,
  Wallet,
  ExternalLink,
  Download,
  Filter,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { handleError, showSuccessToast } from "@/lib/toast";
import { generateLedgerCsv, downloadCsv } from "@/lib/csvExport";
import { featureFlags } from "@/lib/featureFlags";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { TopUpModal } from "@/components/wallet/TopUpModal";
import { WithdrawalModal } from "@/components/wallet/WithdrawalModal";
import { WithdrawalHistory } from "@/components/wallet/WithdrawalHistory";

import {
  getNgnBalance,
  getNgnLedger,
  type NgnBalanceResponse,
  type WalletLedgerEntry,
  type WalletLedgerType,
} from "@/lib/walletApi";
import { useRiskState } from "@/hooks/useRiskState";
import FrozenAccountBanner from "@/components/FrozenAccountBanner";

// Constants
const PAGE_SIZE = 10;

// Transaction type filter configuration
const FILTER_GROUPS = [
  {
    id: "topups",
    label: "Top-ups",
    types: ["top_up"],
  },
  {
    id: "withdrawals",
    label: "Withdrawals",
    types: ["withdrawal"],
  },
  {
    id: "staking",
    label: "Staking",
    types: ["staking_conversion", "staking_reserve", "staking_debit", "staking_refund"],
  },
  {
    id: "reversals",
    label: "Reversals",
    types: ["reversal"],
  },
  {
    id: "rewards",
    label: "Rewards",
    types: ["reward"],
  },
] as const;

type FilterGroupId = (typeof FILTER_GROUPS)[number]["id"];

type LoadState<T> =
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "success"; data: T };

interface LedgerData {
  entries: WalletLedgerEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

function formatNgn(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount);
}

function humanizeEntryType(type: string) {
  const normalized = type.trim().replaceAll("_", " ");
  if (!normalized) return "Activity";
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function statusPresentation(status: WalletLedgerEntry["status"]) {
  if (status === "confirmed") {
    return { label: "Confirmed", variant: "secondary" as const };
  }
  if (status === "failed") {
    return { label: "Failed", variant: "destructive" as const };
  }
  if (status === "approved") {
    return { label: "Approved", variant: "default" as const };
  }
  if (status === "rejected") {
    return { label: "Rejected", variant: "destructive" as const };
  }
  return { label: "Pending", variant: "outline" as const };
}

function getTypesFromFilterIds(filterIds: string[]): WalletLedgerType[] {
  const types: WalletLedgerType[] = [];
  for (const id of filterIds) {
    const group = FILTER_GROUPS.find((g) => g.id === id);
    if (group) {
      types.push(...group.types);
    }
  }
  return types;
}

function getFilterLabel(filterId: string): string {
  const group = FILTER_GROUPS.find((g) => g.id === filterId);
  return group?.label ?? filterId;
}

function WalletPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL state management
  const activeFilters = useMemo(() => {
    const filterParam = searchParams.get("filter");
    return filterParam ? filterParam.split(",").filter(Boolean) : [];
  }, [searchParams]);

  const setFilters = useCallback(
    (filters: string[]) => {
      const params = new URLSearchParams(searchParams);
      if (filters.length > 0) {
        params.set("filter", filters.join(","));
      } else {
        params.delete("filter");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, pathname, router]
  );

  // State
  const [balanceState, setBalanceState] = useState<LoadState<NgnBalanceResponse>>({
    type: "loading",
  });
  const [ledgerState, setLedgerState] = useState<LoadState<LedgerData>>({
    type: "loading",
  });
  const [topUpModalOpen, setTopUpModalOpen] = useState(false);
  const [withdrawalModalOpen, setWithdrawalModalOpen] = useState(false);

  const [reloadNonce, setReloadNonce] = useState(0);

  const { isFrozen, freezeReason } = useRiskState();
          const [isExporting, setIsExporting] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [showFiltersMobile, setShowFiltersMobile] = useState(false);

  const deficit =
    balanceState.type === "success"
      ? Math.max(0, -balanceState.data.totalNgn)
      : 0;
        
         const selectedTypes = useMemo(
    () => getTypesFromFilterIds(activeFilters),
    [activeFilters]
  );
  const hasActiveFilters = activeFilters.length > 0;


  // Retry function
  const retry = useCallback(() => {
    setBalanceState({ type: "loading" });
    setLedgerState({ type: "loading" });
    setReloadNonce((prev) => prev + 1);
  }, []);

  // Initial data fetch
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const [balance, ledger] = await Promise.all([
          getNgnBalance(),
          getNgnLedger({
            limit: PAGE_SIZE,
            type: selectedTypes.length > 0 ? selectedTypes : undefined,
          }),
        ]);

        if (!cancelled) {
          setBalanceState({ type: "success", data: balance });
          setLedgerState({
            type: "success",
            data: {
              entries: ledger.entries,
              nextCursor: ledger.nextCursor ?? null,
              hasMore: !!ledger.nextCursor,
            },
          });
        }
      } catch (err) {
        if (!cancelled) {
          handleError(err, "Failed to load wallet data");
          const message = err instanceof Error ? err.message : "Something went wrong";
          setBalanceState({ type: "error", message });
          setLedgerState({ type: "error", message });
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };


  }, [selectedTypes]);

  // Load more entries
  const loadMore = useCallback(async () => {
    if (ledgerState.type !== "success" || !ledgerState.data.hasMore || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const response = await getNgnLedger({
        cursor: ledgerState.data.nextCursor ?? undefined,
        limit: PAGE_SIZE,
        type: selectedTypes.length > 0 ? selectedTypes : undefined,
      });

      setLedgerState({
        type: "success",
        data: {
          entries: [...ledgerState.data.entries, ...response.entries],
          nextCursor: response.nextCursor ?? null,
          hasMore: !!response.nextCursor,
        },
      });
    } catch (err) {
      handleError(err, "Failed to load more entries");
    } finally {
      setIsLoadingMore(false);
    }
  }, [ledgerState, isLoadingMore, selectedTypes]);

  // Fetch all entries for CSV export
  const fetchAllLedgerEntries = useCallback(
    async (types?: WalletLedgerType[]): Promise<WalletLedgerEntry[]> => {
      const allEntries: WalletLedgerEntry[] = [];
      let cursor: string | null | undefined = null;
      let hasMore = true;

      while (hasMore) {
        const response = await getNgnLedger({
          cursor: cursor || undefined,
          limit: 100,
          type: types && types.length > 0 ? types : undefined,
        });

        allEntries.push(...response.entries);

        if (response.nextCursor) {
          cursor = response.nextCursor;
        } else {
          hasMore = false;
        }
      }

      return allEntries;
    },
    []
  );

  // Handle CSV export
  const handleExportCsv = useCallback(
    async (exportFiltered: boolean) => {
      if (isExporting) return;

      setIsExporting(true);
      try {
        // Determine which entries to export
        let entriesToExport: WalletLedgerEntry[];
        let filenameSuffix: string;

        if (exportFiltered && hasActiveFilters) {
          // Export all entries matching the current filters
          entriesToExport = await fetchAllLedgerEntries(selectedTypes);
          filenameSuffix = `filtered-${activeFilters.join("-")}`;
        } else {
          // Export all entries (unfiltered)
          entriesToExport = await fetchAllLedgerEntries();
          filenameSuffix = "all";
        }

        if (entriesToExport.length === 0) {
          showSuccessToast("No ledger entries to export");
          return;
        }

        // Generate CSV content with stable columns
        const csvContent = generateLedgerCsv(entriesToExport);

        // Generate filename with current date
        const now = new Date();
        const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
        const filename = `wallet-ledger-${filenameSuffix}-${dateStr}.csv`;

        // Download CSV
        downloadCsv(csvContent, filename);

        showSuccessToast(
          `Exported ${entriesToExport.length} ledger entries to CSV`
        );
      } catch (err) {
        handleError(err, "Failed to export ledger to CSV");
      } finally {
        setIsExporting(false);
      }
    },
    [isExporting, fetchAllLedgerEntries, hasActiveFilters, selectedTypes, activeFilters]
  );

  // Clear all filters
  const clearFilters = useCallback(() => {
    setFilters([]);
  }, [setFilters]);

  return (
    <main className="min-h-screen bg-background relative ">
      <div className="container mx-auto px-4 py-8 md:py-10">

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-secondary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <Wallet className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold md:text-3xl">Wallet</h1>
              <p className="text-sm text-muted-foreground">
                Manage your NGN balance and view recent activity.
              </p>
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button
              className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] sm:w-auto"
              onClick={() => setTopUpModalOpen(true)}
            >
              <ArrowDownToLine className="h-4 w-4" />
              Top up
            </Button>
            <Button
              disabled={isFrozen}
              title={isFrozen ? "Account frozen. Please top up wallet." : ""}
              variant="outline"
              className="w-full border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] sm:w-auto"
              onClick={() => setWithdrawalModalOpen(true)}
            >
              <ArrowUpRight className="h-4 w-4" />
              Withdraw
            </Button>
          </div>
        </div>

        {isFrozen && (
          <div className="mb-6">
            <FrozenAccountBanner
              deficit={deficit}
              freezeReason={freezeReason}
              ctaHref="/wallet"
              ctaLabel="Top up wallet"
            />
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <CardHeader className="pb-2">
              <CardDescription>Available</CardDescription>
              <CardTitle className="font-mono text-2xl">
                {balanceState.type === "loading" && (
                  <Skeleton className="h-8 w-40" />
                )}
                {balanceState.type === "error" && "—"}
                {balanceState.type === "success" &&
                  formatNgn(balanceState.data.availableNgn)}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">Spendable funds</p>
            </CardContent>
          </Card>

          <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardDescription>Held</CardDescription>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Held funds info"
                      className="flex h-8 w-8 items-center justify-center border-2 border-foreground bg-muted text-foreground"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={6}>
                    Funds reserved for staking/withdrawals
                  </TooltipContent>
                </Tooltip>
              </div>
              <CardTitle className="font-mono text-2xl">
                {balanceState.type === "loading" && (
                  <Skeleton className="h-8 w-40" />
                )}
                {balanceState.type === "error" && "—"}
                {balanceState.type === "success" &&
                  formatNgn(balanceState.data.heldNgn)}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">Reserved funds</p>
            </CardContent>
          </Card>

          <Card className="border-3 border-foreground bg-primary/10 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <CardHeader className="pb-2">
              <CardDescription>Total</CardDescription>
              <CardTitle className="font-mono text-2xl text-primary">
                {balanceState.type === "loading" && (
                  <Skeleton className="h-8 w-40" />
                )}
                {balanceState.type === "error" && "—"}
                {balanceState.type === "success" &&
                  formatNgn(balanceState.data.totalNgn)}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">
                Available + held
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="mt-8">
          {/* Section Header with Filter Toggle (Mobile) */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold md:text-xl">Activity</h2>
              {/* Mobile Filter Toggle */}
              <Button
                variant="outline"
                size="sm"
                className="sm:hidden border-2 border-foreground"
                onClick={() => setShowFiltersMobile(!showFiltersMobile)}
              >
                <Filter className="mr-2 h-4 w-4" />
                Filters
                {hasActiveFilters && (
                  <Badge variant="secondary" className="ml-2">
                    {activeFilters.length}
                  </Badge>
                )}
                {showFiltersMobile ? (
                  <ChevronUp className="ml-2 h-4 w-4" />
                ) : (
                  <ChevronDown className="ml-2 h-4 w-4" />
                )}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {/* CSV Export Dropdown */}
              <div className="relative group">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isExporting || ledgerState.type !== "success"}
                  className="border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
                >
                  {isExporting ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Export CSV
                    </>
                  )}
                </Button>
                {/* Export Options Dropdown */}
                <div className="absolute right-0 top-full z-10 mt-2 hidden w-56 rounded-md border-3 border-foreground bg-background p-2 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] group-hover:block">
                  <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">
                    Export options
                  </p>
                  <button
                    onClick={() => handleExportCsv(false)}
                    className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-muted text-left"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Export all entries
                  </button>
                  {featureFlags.enableAdvancedWalletOps && hasActiveFilters && (
                    <button
                      onClick={() => handleExportCsv(true)}
                      className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-muted text-left"
                    >
                      <Filter className="mr-2 h-4 w-4" />
                      Export filtered ({activeFilters.map(getFilterLabel).join(", ")})
                    </button>
                  )}
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                onClick={retry}
              >
                <RefreshCw className="h-4 w-4" />
                <span className="sr-only">Retry</span>
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div
            className={`mb-4 ${showFiltersMobile ? "block" : "hidden"} sm:block`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">
                <Filter className="mr-1 inline h-4 w-4" />
                Filter by:
              </span>
              <ToggleGroup
                type="multiple"
                value={activeFilters}
                onValueChange={setFilters}
                className="flex flex-wrap gap-2"
              >
                {FILTER_GROUPS.map((group) => (
                  <ToggleGroupItem
                    key={group.id}
                    value={group.id}
                    aria-label={`Filter by ${group.label}`}
                    className="border-2 border-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {group.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-8 px-2 text-xs"
                >
                  <X className="mr-1 h-3 w-3" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* Activity Card */}
          <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <CardContent className="pt-6">
              {ledgerState.type === "loading" && (
                <div className="space-y-3">
                  {Array.from({ length: 5 }, (_, i) => (
                    <div
                      key={`skeleton-${i}`}
                      className="flex items-center justify-between gap-4 border-b border-foreground/10 pb-3 last:border-0 last:pb-0"
                    >
                      <div className="flex min-w-0 flex-col gap-2">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-56" />
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-5 w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {ledgerState.type === "error" && (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-destructive/10">
                    <AlertCircle className="h-6 w-6 text-destructive" />
                  </div>
                  <div>
                    <p className="font-bold">Could not load wallet activity</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {ledgerState.message}
                    </p>
                  </div>
                  <Button
                    className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                    onClick={retry}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retry
                  </Button>
                </div>
              )}

              {ledgerState.type === "success" && ledgerState.data.entries.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-muted">
                    <Wallet className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="font-bold">
                    {hasActiveFilters ? "No matching activity" : "No activity yet"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {hasActiveFilters
                      ? "Try adjusting your filters to see more results."
                      : "Your deposits and withdrawals will show up here."}
                  </p>
                  {hasActiveFilters && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 border-2 border-foreground"
                      onClick={clearFilters}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Clear filters
                    </Button>
                  )}
                </div>
              )}

              {ledgerState.type === "success" && ledgerState.data.entries.length > 0 && (
                <div className="space-y-4">
                  <div className="divide-y divide-foreground/10">
                    {ledgerState.data.entries.map((entry: WalletLedgerEntry) => {
                      const amount = entry.amountNgn;
                      const isCredit = amount > 0;
                      const amountText = `${isCredit ? "+" : "-"}${formatNgn(
                        Math.abs(amount)
                      )}`;

                      const { label, variant } = statusPresentation(entry.status);
                      const isPending = entry.status === "pending";

                      return (
                        <div
                          key={entry.id}
                          className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between ${
                            isPending ? "bg-muted/50" : ""
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-bold">{humanizeEntryType(entry.type)}</p>
                              {isPending && (
                                <div className="flex h-2 w-2 animate-pulse rounded-full bg-primary" />
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>{new Date(entry.timestamp).toLocaleString("en-NG")}</span>
                              {entry.reference ? (
                                <span className="truncate border border-foreground/20 bg-muted px-2 py-0.5 font-mono">
                                  {entry.reference}
                                </span>
                              ) : null}
                            </div>
                            {isPending && (
                              <p className="mt-2 text-xs text-muted-foreground">
                                {entry.type === "top_up" && "Waiting for payment confirmation"}
                                {entry.type === "withdrawal" && "Processing withdrawal request"}
                                {entry.type === "staking_conversion" &&
                                  "Converting NGN to USDC for staking"}
                                {entry.type === "staking_reserve" && "Reserving funds for staking"}
                                {entry.type === "staking_debit" && "Processing staking debit"}
                                {entry.type === "staking_refund" && "Processing staking refund"}
                                {entry.type === "reversal" && "Processing reversal"}
                                {entry.type === "reward" && "Processing reward"}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
                            <p
                              className={`font-mono text-base font-black ${
                                isCredit ? "text-secondary" : "text-destructive"
                              }`}
                            >
                              {amountText}
                            </p>
                            <div className="flex flex-col items-end gap-2">
                              <Badge variant={variant}>
                                {isPending && (
                                  <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                                )}
                                {label}
                              </Badge>
                              {(entry.status === "failed" || entry.status === "rejected") && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    globalThis.location.href =
                                      "mailto:support@example.com?subject=Transaction Issue - " +
                                      (entry.reference || entry.id);
                                  }}
                                >
                                  <ExternalLink className="mr-1 h-3 w-3" />
                                  Contact support
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Pagination / Load More */}
                  {ledgerState.data.hasMore && (
                    <div className="flex flex-col items-center gap-3 pt-4">
                      <Button
                        variant="outline"
                        onClick={loadMore}
                        disabled={isLoadingMore}
                        className="w-full border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50 sm:w-auto"
                      >
                        {isLoadingMore ? (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                            Loading...
                          </>
                        ) : (
                          <>
                            <ChevronDown className="mr-2 h-4 w-4" />
                            Load more
                          </>
                        )}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Showing {ledgerState.data.entries.length} entries
                      </p>
                    </div>
                  )}

                  {!ledgerState.data.hasMore && ledgerState.data.entries.length > PAGE_SIZE && (
                    <p className="pt-4 text-center text-xs text-muted-foreground">
                      All {ledgerState.data.entries.length} entries loaded
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <WithdrawalHistory className="mt-8" />

        {balanceState.type === "error" && (
          <div className="mt-6 rounded-md border-2 border-foreground bg-muted p-4 text-sm">
            <p className="font-bold">Wallet data unavailable</p>
            <p className="mt-1 text-muted-foreground">{balanceState.message}</p>
          </div>
        )}
      </div>
      <TopUpModal
        open={topUpModalOpen}
        onOpenChange={setTopUpModalOpen}
        onSuccess={() => {
          // Refresh wallet data after successful top-up initiation
          retry();
        }}
      />
      <WithdrawalModal
        open={withdrawalModalOpen}
        onOpenChange={setWithdrawalModalOpen}
        onSuccess={() => {
          // Refresh wallet data after successful withdrawal initiation
          retry();
        }}
        availableBalance={balanceState.type === "success" ? balanceState.data.availableNgn : 0}
        isFrozen={isFrozen}
        freezeReason={freezeReason}
        deficitNgn={deficit}
        onTopUpClick={() => {
          setWithdrawalModalOpen(false);
          setTopUpModalOpen(true);
        }}
      />
    </main>
  );
}

// Wrapper with Suspense for useSearchParams
export default function WalletPage() {
  return (
    <Suspense fallback={<WalletPageSkeleton />}>
      <WalletPageContent />
    </Suspense>
  );
}

// Skeleton shown during suspense
function WalletPageSkeleton() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 md:py-10">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-secondary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <Wallet className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold md:text-3xl">Wallet</h1>
              <p className="text-sm text-muted-foreground">
                Manage your NGN balance and view recent activity.
              </p>
            </div>
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="mt-2 h-8 w-40" />
              </CardHeader>
              <CardContent className="pt-0">
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-9 w-24" />
          </div>
          <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <CardContent className="pt-6">
              <div className="space-y-3">
                {Array.from({ length: 5 }, (_, i) => (
                  <div
                    key={`skeleton-${i}`}
                    className="flex items-center justify-between gap-4 border-b border-foreground/10 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-col gap-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-56" />
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-5 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
