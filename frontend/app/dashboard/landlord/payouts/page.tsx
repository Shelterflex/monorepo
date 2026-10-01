"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  DollarSign, Filter, X,
  AlertTriangle, ChevronDown, ChevronUp, TrendingUp, TrendingDown,
  BarChart3, Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/data-state";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { PayoutDrillDown } from "@/components/landlord/payout-drill-down";
import {
  getPayoutSchedule,
  formatCurrency, formatPayoutDate, formatPeriodLabel,
  DELAY_REASON_LABELS, PAYOUT_STATUS_LABELS, PAYOUT_CHANNEL_LABELS,
  type PayoutPeriod, type PayoutScheduleSummary, type LandlordPayout,
  type PayoutStatus, type PayoutChannel, type PayoutGrouping,
} from "@/lib/landlordPayoutApi";

const STATUSES: PayoutStatus[] = [
  "scheduled", "processing", "completed", "delayed", "failed", "on_hold",
];
const CHANNELS: PayoutChannel[] = [
  "bank_transfer", "mobile_money", "crypto_wallet", "check",
];

const STATUS_CLASSES: Record<PayoutStatus, string> = {
  scheduled: "bg-blue-100 text-blue-800 border-blue-300",
  processing: "bg-indigo-100 text-indigo-800 border-indigo-300",
  completed: "bg-green-100 text-green-800 border-green-300",
  delayed: "bg-amber-100 text-amber-800 border-amber-300",
  failed: "bg-red-100 text-red-800 border-red-300",
  on_hold: "bg-gray-100 text-gray-800 border-gray-300",
};

function StatusBadge({ status }: { status: PayoutStatus }) {
  return (
    <Badge
      className={`text-xs font-bold ${STATUS_CLASSES[status]}`}
      aria-label={`Status: ${PAYOUT_STATUS_LABELS[status]}`}
    >
      {PAYOUT_STATUS_LABELS[status]}
    </Badge>
  );
}

export default function LandlordPayoutSchedulePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const drillPayoutId = searchParams.get("payout");

  const [periods, setPeriods] = useState<PayoutPeriod[]>([]);
  const [summary, setSummary] = useState<PayoutScheduleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PayoutStatus | "">(
    (searchParams.get("status") as PayoutStatus) || "",
  );
  const [channelFilter, setChannelFilter] = useState<PayoutChannel | "">(
    (searchParams.get("channel") as PayoutChannel) || "",
  );
  const [grouping, setGrouping] = useState<PayoutGrouping>(
    (searchParams.get("grouping") as PayoutGrouping) || "monthly",
  );
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPayoutSchedule({
        status: statusFilter || undefined,
        channel: channelFilter || undefined,
        grouping,
      });
      setPeriods(result.data.periods);
      setSummary(result.data.summary);
    } catch (err: any) {
      setError(err?.message || "Failed to load payout schedule");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, channelFilter, grouping]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDrillDown = useCallback((payoutId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("payout", payoutId);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, pathname, searchParams]);

  const closeDrillDown = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("payout");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const handleFilterChange = useCallback((setter: (v: any) => void) => (value: any) => {
    setter(value);
    // Update URL params for filters
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("status", statusFilter || "");
      params.set("channel", channelFilter || "");
    }
  }, [searchParams, statusFilter, channelFilter]);

  const summaryCards = useMemo(() => {
    if (!summary) return null;
    return (
      <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <div className="flex items-center gap-2 text-sm font-bold uppercase text-muted-foreground">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />Gross Total
          </div>
          <p className="mt-1 text-2xl font-bold">{formatCurrency(summary.totalGross, summary.currency)}</p>
        </Card>
        <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <div className="flex items-center gap-2 text-sm font-bold uppercase text-muted-foreground">
            <TrendingDown className="h-4 w-4" aria-hidden="true" />Total Deductions
          </div>
          <p className="mt-1 text-2xl font-bold text-red-600">
            -{formatCurrency(summary.totalDeductions, summary.currency)}
          </p>
        </Card>
        <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <div className="flex items-center gap-2 text-sm font-bold uppercase text-muted-foreground">
            <DollarSign className="h-4 w-4" aria-hidden="true" />Net Payout
          </div>
          <p className="mt-1 text-2xl font-bold text-green-700">{formatCurrency(summary.totalNet, summary.currency)}</p>
        </Card>
        <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <div className="flex items-center gap-2 text-sm font-bold uppercase text-muted-foreground">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />Delayed / On Hold
          </div>
          <p className="mt-1 text-2xl font-bold text-amber-600">
            {summary.delayedPayouts} / {summary.onHoldPayouts}
          </p>
        </Card>
      </div>
    );
  }, [summary]);

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <DashboardSidebar
        role="landlord"
        userInfo={{ name: "Adebayo Okonkwo", roleLabel: "Landlord" }}
      />

      <main id="main-content" className="min-h-screen pt-20 lg:ml-64">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="mb-6 md:mb-8">
            <h1 className="text-2xl font-bold text-foreground md:text-3xl lg:text-4xl">Payout Schedule</h1>
            <p className="mt-2 text-sm text-muted-foreground md:text-base">
              Forecasted payouts, deductions, and projected monthly cashflow
            </p>
          </div>

          {/* Summary Cards */}
          {summaryCards}

          {/* Filters */}
          <Card className="mb-6 border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <div className="w-full md:w-44">
                <label htmlFor="status-filter" className="mb-1 block text-sm font-bold">
                  <Filter className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Status
                </label>
                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as PayoutStatus | "")}
                  className="w-full border-3 border-foreground bg-background px-3 py-2 text-sm shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:outline-none"
                >
                  <option value="">All Statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{PAYOUT_STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div className="w-full md:w-44">
                <label htmlFor="channel-filter" className="mb-1 block text-sm font-bold">
                  <Filter className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Channel
                </label>
                <select
                  id="channel-filter"
                  value={channelFilter}
                  onChange={(e) => setChannelFilter(e.target.value as PayoutChannel | "")}
                  className="w-full border-3 border-foreground bg-background px-3 py-2 text-sm shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:outline-none"
                >
                  <option value="">All Channels</option>
                  {CHANNELS.map((c) => <option key={c} value={c}>{PAYOUT_CHANNEL_LABELS[c]}</option>)}
                </select>
              </div>
              <div className="w-full md:w-40">
                <label htmlFor="grouping" className="mb-1 block text-sm font-bold">
                  <Calendar className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Grouping
                </label>
                <select
                  id="grouping"
                  value={grouping}
                  onChange={(e) => setGrouping(e.target.value as PayoutGrouping)}
                  className="w-full border-3 border-foreground bg-background px-3 py-2 text-sm shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:outline-none"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              {(statusFilter || channelFilter) && (
                <Button
                  variant="outline"
                  onClick={() => { setStatusFilter(""); setChannelFilter(""); }}
                  className="border-2 border-foreground font-bold"
                  aria-label="Clear all filters"
                >
                  <X className="mr-1 h-4 w-4" />Clear
                </Button>
              )}
            </div>
          </Card>

          {/* Timeline */}
          {loading ? (
            <LoadingState label="Loading payout schedule" className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="mt-4 h-4 w-48" />
                </Card>
              ))}
            </LoadingState>
          ) : error ? (
            <ErrorState
              title="Payout schedule is unavailable"
              description={error}
              onRetry={fetchData}
              retryLabel="Retry"
            />
          ) : periods.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No payouts scheduled"
              description={
                statusFilter || channelFilter
                  ? "No payout periods match these filters. Clearing them shows your full schedule."
                  : "Payouts appear here once a tenant pays rent on one of your properties. Add a payout account so we can send funds the moment they clear."
              }
              action={
                statusFilter || channelFilter
                  ? {
                      label: "Clear filters",
                      onClick: () => {
                        setStatusFilter("");
                        setChannelFilter("");
                      },
                    }
                  : {
                      label: "Set up payouts",
                      href: "/dashboard/landlord/settings/payouts",
                    }
              }
            />
          ) : (
            <div className="space-y-4" role="list" aria-label="Payout periods">
              {periods.map((period) => (
                <PeriodCard
                  key={period.periodLabel}
                  period={period}
                  expanded={expandedPeriod === period.periodLabel}
                  onToggle={() => setExpandedPeriod(expandedPeriod === period.periodLabel ? null : period.periodLabel)}
                  onDrillDown={handleDrillDown}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Drill-down Modal */}
      {drillPayoutId && (
        <PayoutDrillDown
          payoutId={drillPayoutId}
          onClose={closeDrillDown}
        />
      )}
    </div>
  );
}

/* ── Period Card ──────────────────────────────────────────────────────────── */

function PeriodCard({
  period,
  expanded,
  onToggle,
  onDrillDown,
}: {
  period: PayoutPeriod;
  expanded: boolean;
  onToggle: () => void;
  onDrillDown: (payoutId: string) => void;
}) {
  return (
    <Card
      className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
      role="listitem"
    >
      {/* Period Header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between p-4 text-left"
        aria-expanded={expanded}
        aria-controls={`period-${period.periodLabel}`}
      >
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <span className="text-lg font-bold">{formatPeriodLabel(period.periodLabel)}</span>
          {period.delayedCount > 0 && (
            <Badge
              className="border-amber-300 bg-amber-100 text-xs font-bold text-amber-800"
              aria-label={`${period.delayedCount} delayed payout${period.delayedCount > 1 ? "s" : ""}`}
            >
              <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />{period.delayedCount} delayed
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-xs font-bold uppercase text-muted-foreground">Net</p>
            <p className="font-bold text-green-700">{formatCurrency(period.netTotal)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase text-muted-foreground">Gross</p>
            <p className="font-bold">{formatCurrency(period.grossTotal)}</p>
          </div>
          {expanded
            ? <ChevronUp className="h-5 w-5" aria-hidden="true" />
            : <ChevronDown className="h-5 w-5" aria-hidden="true" />}
        </div>
      </button>

      {/* Period Summary Bar */}
      <div className="border-t-2 border-foreground/10 bg-muted/30 px-4 py-3">
        <div className="grid grid-cols-4 gap-4 text-center text-sm">
          <div>
            <p className="font-bold text-muted-foreground">Payouts</p>
            <p className="font-bold">{period.payoutCount}</p>
          </div>
          <div>
            <p className="font-bold text-muted-foreground">Gross</p>
            <p className="font-bold">{formatCurrency(period.grossTotal)}</p>
          </div>
          <div>
            <p className="font-bold text-red-600">Deductions</p>
            <p className="font-bold text-red-600">-{formatCurrency(period.deductionsTotal)}</p>
          </div>
          <div>
            <p className="font-bold text-green-700">Net</p>
            <p className="font-bold text-green-700">{formatCurrency(period.netTotal)}</p>
          </div>
        </div>
      </div>

      {/* Expanded Payout Table */}
      {expanded && (
        <div
          id={`period-${period.periodLabel}`}
          className="border-t-2 border-foreground/10"
        >
          <Table aria-label={`Payouts for ${formatPeriodLabel(period.periodLabel)}`}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead>Property</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Gross</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {period.payouts.map((payout) => (
                <TableRow key={payout.id}>
                  <TableCell>
                    <StatusBadge status={payout.status} />
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => onDrillDown(payout.id)}
                      className="text-left font-bold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`View payout details for ${payout.propertyName}`}
                    >
                      {payout.propertyName}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {formatPayoutDate(payout.scheduledDate)}
                      {payout.delayReasons.length > 0 && (
                        <span className="ml-2 text-amber-600">
                          &mdash; {payout.delayReasons.map((r) => DELAY_REASON_LABELS[r as keyof typeof DELAY_REASON_LABELS]).join(", ")}
                        </span>
                      )}
                    </p>
                  </TableCell>
                  <TableCell className="text-right font-bold text-green-700">
                    {formatCurrency(payout.netAmount, payout.currency)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {formatCurrency(payout.grossAmount, payout.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
