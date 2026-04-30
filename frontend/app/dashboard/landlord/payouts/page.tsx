"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Home, Building2, DollarSign, Settings, Menu, X, Search, Filter,
  AlertTriangle, CheckCircle2, Clock, XCircle, MinusCircle, ChevronDown,
  ChevronUp, TrendingUp, TrendingDown, BarChart3, Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DashboardHeader } from "@/components/dashboard-header";
import { PayoutDrillDown } from "@/components/landlord/payout-drill-down";
import {
  getPayoutSchedule, getPayoutDetail,
  formatCurrency, formatPeriodLabel,
  DELAY_REASON_LABELS, PAYOUT_STATUS_LABELS, PAYOUT_CHANNEL_LABELS,
  type PayoutPeriod, type PayoutScheduleSummary, type LandlordPayout,
  type PayoutStatus, type PayoutChannel, type PayoutGrouping,
} from "@/lib/landlordPayoutApi";

const STATUSES: PayoutStatus[] = ["scheduled", "processing", "completed", "delayed", "failed", "on_hold"];
const CHANNELS: PayoutChannel[] = ["bank_transfer", "mobile_money", "crypto_wallet", "check"];

function StatusBadge({ status }: { status: PayoutStatus }) {
  const cfg: Record<PayoutStatus, string> = {
    scheduled: "bg-blue-100 text-blue-800 border-blue-300",
    processing: "bg-indigo-100 text-indigo-800 border-indigo-300",
    completed: "bg-green-100 text-green-800 border-green-300",
    delayed: "bg-amber-100 text-amber-800 border-amber-300",
    failed: "bg-red-100 text-red-800 border-red-300",
    on_hold: "bg-gray-100 text-gray-800 border-gray-300",
  };
  return <Badge className={`text-xs font-bold ${cfg[status]}`}>{PAYOUT_STATUS_LABELS[status]}</Badge>;
}

export default function LandlordPayoutSchedulePage() {
  const [periods, setPeriods] = useState<PayoutPeriod[]>([]);
  const [summary, setSummary] = useState<PayoutScheduleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PayoutStatus | "">("");
  const [channelFilter, setChannelFilter] = useState<PayoutChannel | "">("");
  const [grouping, setGrouping] = useState<PayoutGrouping>("monthly");
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Drill-down state
  const [drillPayout, setDrillPayout] = useState<LandlordPayout | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

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

  const handleDrillDown = async (payout: LandlordPayout) => {
    setDrillLoading(true);
    try {
      const result = await getPayoutDetail(payout.id);
      setDrillPayout(result.data);
    } catch {
      setDrillPayout(payout);
    } finally {
      setDrillLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <button onClick={() => setSidebarOpen(!sidebarOpen)} className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center border-3 border-foreground bg-primary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] lg:hidden">
        {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {sidebarOpen && <button type="button" aria-label="Close sidebar" className="fixed inset-0 z-40 bg-foreground/50 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <aside className={`fixed left-0 top-0 z-40 h-screen w-64 border-r-3 border-foreground bg-card pt-20 transition-transform lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-full flex-col px-4 py-6">
          <div className="mb-8 border-3 border-foreground bg-secondary p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <p className="text-sm font-medium text-foreground">Logged in as</p>
            <p className="text-lg font-bold text-foreground">Adebayo Okonkwo</p>
            <p className="text-sm text-muted-foreground">Landlord</p>
          </div>
          <nav className="flex-1 space-y-2">
            <Link href="/dashboard/landlord" className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" onClick={() => setSidebarOpen(false)}>
              <Home className="h-5 w-5" />Dashboard
            </Link>
            <Link href="/dashboard/landlord/properties" className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" onClick={() => setSidebarOpen(false)}>
              <Building2 className="h-5 w-5" />Properties
            </Link>
            <Link href="/dashboard/landlord/payouts" className="flex items-center gap-3 border-3 border-foreground bg-primary p-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" onClick={() => setSidebarOpen(false)}>
              <DollarSign className="h-5 w-5" />Payout Schedule
            </Link>
            <Link href="/dashboard/landlord/settings" className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" onClick={() => setSidebarOpen(false)}>
              <Settings className="h-5 w-5" />Settings
            </Link>
          </nav>
        </div>
      </aside>

      <main className="min-h-screen pt-20 lg:ml-64">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="mb-6 md:mb-8">
            <h1 className="text-2xl font-bold text-foreground md:text-3xl lg:text-4xl">Payout Schedule</h1>
            <p className="mt-2 text-sm text-muted-foreground md:text-base">
              Forecasted payouts, deductions, and projected monthly cashflow
            </p>
          </div>

          {/* Summary Cards */}
          {summary && (
            <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <div className="flex items-center gap-2 text-sm font-bold uppercase text-muted-foreground">
                  <TrendingUp className="h-4 w-4" />Gross Total
                </div>
                <p className="mt-1 text-2xl font-bold">{formatCurrency(summary.totalGross, summary.currency)}</p>
              </Card>
              <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <div className="flex items-center gap-2 text-sm font-bold uppercase text-muted-foreground">
                  <TrendingDown className="h-4 w-4" />Total Deductions
                </div>
                <p className="mt-1 text-2xl font-bold text-red-600">-{formatCurrency(summary.totalDeductions, summary.currency)}</p>
              </Card>
              <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <div className="flex items-center gap-2 text-sm font-bold uppercase text-muted-foreground">
                  <DollarSign className="h-4 w-4" />Net Payout
                </div>
                <p className="mt-1 text-2xl font-bold text-green-700">{formatCurrency(summary.totalNet, summary.currency)}</p>
              </Card>
              <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <div className="flex items-center gap-2 text-sm font-bold uppercase text-muted-foreground">
                  <AlertTriangle className="h-4 w-4" />Delayed / On Hold
                </div>
                <p className="mt-1 text-2xl font-bold text-amber-600">{summary.delayedPayouts} / {summary.onHoldPayouts}</p>
              </Card>
            </div>
          )}

          {/* Filters */}
          <Card className="mb-6 border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <div className="w-full md:w-44">
                <label className="mb-1 block text-sm font-bold"><Filter className="mr-1 inline h-3.5 w-3.5" />Status</label>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PayoutStatus | "")} className="w-full border-3 border-foreground bg-background px-3 py-2 text-sm shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:outline-none">
                  <option value="">All Statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{PAYOUT_STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div className="w-full md:w-44">
                <label className="mb-1 block text-sm font-bold"><Filter className="mr-1 inline h-3.5 w-3.5" />Channel</label>
                <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value as PayoutChannel | "")} className="w-full border-3 border-foreground bg-background px-3 py-2 text-sm shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:outline-none">
                  <option value="">All Channels</option>
                  {CHANNELS.map((c) => <option key={c} value={c}>{PAYOUT_CHANNEL_LABELS[c]}</option>)}
                </select>
              </div>
              <div className="w-full md:w-40">
                <label className="mb-1 block text-sm font-bold"><Calendar className="mr-1 inline h-3.5 w-3.5" />Grouping</label>
                <select value={grouping} onChange={(e) => setGrouping(e.target.value as PayoutGrouping)} className="w-full border-3 border-foreground bg-background px-3 py-2 text-sm shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:outline-none">
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              {(statusFilter || channelFilter) && (
                <Button variant="outline" onClick={() => { setStatusFilter(""); setChannelFilter(""); }} className="border-2 border-foreground font-bold">
                  <X className="mr-1 h-4 w-4" />Clear
                </Button>
              )}
            </div>
          </Card>

          {/* Timeline */}
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="animate-pulse border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <div className="h-6 w-32 bg-muted" />
                  <div className="mt-4 h-4 w-48 bg-muted" />
                </Card>
              ))}
            </div>
          ) : error ? (
            <Card className="border-3 border-destructive p-6 text-center">
              <XCircle className="mx-auto h-12 w-12 text-destructive" />
              <p className="mt-4 font-bold text-destructive">{error}</p>
              <Button onClick={fetchData} className="mt-4 border-2 border-foreground font-bold">Retry</Button>
            </Card>
          ) : periods.length === 0 ? (
            <Card className="border-3 border-foreground p-8 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <BarChart3 className="mx-auto h-16 w-16 text-muted-foreground" />
              <p className="mt-4 text-lg font-bold">No payouts scheduled</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {statusFilter || channelFilter ? "Try adjusting your filters" : "Payouts will appear here once scheduled"}
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {periods.map((period) => (
                <Card key={period.periodLabel} className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  {/* Period Header */}
                  <button
                    onClick={() => setExpandedPeriod(expandedPeriod === period.periodLabel ? null : period.periodLabel)}
                    className="flex w-full items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="h-5 w-5 text-muted-foreground" />
                      <span className="text-lg font-bold">{formatPeriodLabel(period.periodLabel)}</span>
                      {period.delayedCount > 0 && (
                        <Badge className="border-amber-300 bg-amber-100 text-xs font-bold text-amber-800">
                          <AlertTriangle className="mr-1 h-3 w-3" />{period.delayedCount} delayed
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
                      {expandedPeriod === period.periodLabel ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
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

                  {/* Expanded Payout List */}
                  {expandedPeriod === period.periodLabel && (
                    <div className="border-t-2 border-foreground/10">
                      {period.payouts.map((payout) => (
                        <button
                          key={payout.id}
                          onClick={() => handleDrillDown(payout)}
                          className="flex w-full items-center justify-between border-b border-foreground/5 px-4 py-3 text-left transition-colors hover:bg-muted/50 last:border-0"
                        >
                          <div className="flex items-center gap-3">
                            <StatusBadge status={payout.status} />
                            <div>
                              <p className="font-bold">{payout.propertyName}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(payout.scheduledDate).toLocaleDateString()}
                                {payout.delayReasons.length > 0 && (
                                  <span className="ml-2 text-amber-600">
                                    — {payout.delayReasons.map(r => DELAY_REASON_LABELS[r as keyof typeof DELAY_REASON_LABELS]).join(", ")}
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold">{formatCurrency(payout.netAmount, payout.currency)}</p>
                            <p className="text-xs text-muted-foreground">{formatCurrency(payout.grossAmount, payout.currency)} gross</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Drill-down Modal */}
      {(drillPayout || drillLoading) && (
        <PayoutDrillDown
          payout={drillPayout}
          onClose={() => setDrillPayout(null)}
        />
      )}
    </div>
  );
}
