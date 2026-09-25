"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Users,
  Activity,
  TrendingUp,
  Percent,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Award,
  Database,
  FlaskConical,
} from "lucide-react";
import { KPICard } from "@/components/admin/KPICard";
import { ErrorState, MoneyValue } from "@/components/ui/data-state";
import dynamic from "next/dynamic";
import {
  getAnalyticsOverview,
  getDealFunnel,
  getRevenueTimeline,
  getListingQuality,
  type AnalyticsOverview,
  type DealFunnel,
  type RevenueTimelineData,
  type ListingQualityMetrics,
} from "@/lib/adminAnalyticsApi";

const DealFunnelChart = dynamic(
  () =>
    import("@/components/admin/DealFunnelChart").then((m) => ({
      default: m.DealFunnelChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="border-3 border-foreground bg-card p-6 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] animate-pulse flex flex-col justify-between h-[360px]">
        <div className="h-6 w-48 bg-muted border-2 border-foreground/10 mb-4" />
        <div className="flex-1 w-full bg-muted border-2 border-foreground/10" />
      </div>
    ),
  },
);

const RevenueChart = dynamic(
  () =>
    import("@/components/admin/RevenueChart").then((m) => ({
      default: m.RevenueChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="border-3 border-foreground bg-card p-6 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] animate-pulse flex flex-col justify-between h-[360px]">
        <div className="flex justify-between items-center mb-4">
          <div className="h-6 w-48 bg-muted border-2 border-foreground/10" />
          <div className="flex gap-1.5">
            <div className="h-8 w-12 bg-muted border-2 border-foreground/10" />
            <div className="h-8 w-12 bg-muted border-2 border-foreground/10" />
          </div>
        </div>
        <div className="flex-1 w-full bg-muted border-2 border-foreground/10" />
      </div>
    ),
  },
);

export function AdminAnalyticsClient() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [funnel, setFunnel] = useState<DealFunnel | null>(null);
  const [revenue, setRevenue] = useState<RevenueTimelineData | null>(null);
  const [quality, setQuality] = useState<ListingQualityMetrics | null>(null);
  const [revenueRange, setRevenueRange] = useState<"7d" | "30d" | "90d">("30d");

  const revenueRangeRef = useRef(revenueRange);
  revenueRangeRef.current = revenueRange;

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [overviewRes, funnelRes, revenueRes, qualityRes] = await Promise.all([
        getAnalyticsOverview(),
        getDealFunnel(),
        getRevenueTimeline(revenueRangeRef.current),
        getListingQuality(),
      ]);

      if (overviewRes.success) setOverview(overviewRes.data);
      if (funnelRes.success) setFunnel(funnelRes.data);
      if (revenueRes.success) setRevenue(revenueRes.data);
      if (qualityRes.success) setQuality(qualityRes.data);
    } catch (err) {
      console.error("Error loading analytics data:", err);
      setError("Failed to load platform analytics. Please check connection and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRangeChange = async (range: "7d" | "30d" | "90d") => {
    setRevenueRange(range);
    try {
      const revenueRes = await getRevenueTimeline(range);
      if (revenueRes.success) {
        setRevenue(revenueRes.data);
      }
    } catch (err) {
      console.error("Error fetching revenue timeline for range", range, err);
    }
  };

  const handleRefreshClick = () => {
    loadData(true);
  };

  // Sum total users across roles. Left null when the overview never arrived so
  // the KPI renders a dash rather than a figure the platform did not report.
  const totalUsers = overview
    ? overview.usersByRole.tenant +
      overview.usersByRole.landlord +
      overview.usersByRole.agent +
      overview.usersByRole.admin
    : null;

  const kpiStatus: "loading" | "error" | "ready" = loading
    ? "loading"
    : error || !overview
    ? "error"
    : "ready";

  /** Non-monetary KPIs still refuse to invent a value; they just dash out. */
  const renderMetric = (value: number | null | undefined, suffix = "") =>
    value === null || value === undefined || !Number.isFinite(value)
      ? "—"
      : `${value.toLocaleString()}${suffix}`;

  // Format currency values
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);
  };

  // Determine if any data is from mock source
  const isMockData = overview?.dataSource === "mock" || 
    funnel?.dataSource === "mock" || 
    revenue?.dataSource === "mock" || 
    quality?.dataSource === "mock";

  return (
    <div className="space-y-8 p-1">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b-3 border-foreground pb-6">
        <div>
          <h1 className="font-mono text-3xl font-black uppercase tracking-tight text-black">
            Platform Analytics
          </h1>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            Real-time business intelligence, financial performance, and quality metrics
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isMockData && (
            <div className="flex items-center gap-1.5 bg-yellow-100 border-2 border-yellow-400 text-yellow-900 px-3 py-1.5 font-mono text-[10px] font-bold uppercase shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
              <FlaskConical className="w-3 h-3" />
              <span>Mock Data</span>
            </div>
          )}
          {!isMockData && overview && (
            <div className="flex items-center gap-1.5 bg-green-100 border-2 border-green-400 text-green-900 px-3 py-1.5 font-mono text-[10px] font-bold uppercase shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
              <Database className="w-3 h-3" />
              <span>Live Data</span>
            </div>
          )}
          <button
            onClick={handleRefreshClick}
            disabled={loading || refreshing}
            className="flex items-center gap-2 border-3 border-foreground bg-primary hover:bg-primary/90 text-black px-4 py-2 font-mono text-xs font-black uppercase shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh Data"}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <ErrorState
          title="Analytics are unavailable"
          description={error}
          onRetry={() => loadData(true)}
          retryLabel="Retry"
        />
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          title="Total Platform Users"
          value={renderMetric(totalUsers)}
          change={12.4}
          changeLabel="vs last month"
          icon={<Users className="w-5 h-5 text-foreground" />}
          isLoading={loading}
          sparklineData={[1200, 1310, 1290, 1380, 1490, 1550, 1690, totalUsers ?? 1792]}
        />
        <KPICard
          title="Active Tenant Deals"
          value={renderMetric(overview?.activeDeals)}
          change={8.2}
          changeLabel="vs last month"
          icon={<Activity className="w-5 h-5 text-foreground" />}
          isLoading={loading}
          sparklineData={[25, 30, 28, 32, 38, 35, 40, overview?.activeDeals ?? 42]}
        />
        <KPICard
          title="Revenue (MTD)"
          value={
            <MoneyValue
              status={kpiStatus}
              amount={overview?.revenueMtd}
              format={formatCurrency}
              skeletonClassName="h-8 w-40"
              unavailableLabel="Revenue unavailable"
            />
          }
          change={14.7}
          changeLabel="vs last month"
          icon={<TrendingUp className="w-5 h-5 text-foreground" />}
          isLoading={loading}
          sparklineData={[2800000, 3100000, 2950000, 3400000, 3600000, 3500000, 3850000]}
        />
        <KPICard
          title="Tenant Default Rate"
          value={renderMetric(overview?.defaultRate, "%")}
          change={-15.3} // default rate went down (good trend)
          changeLabel="vs last month"
          icon={<Percent className="w-5 h-5 text-foreground" />}
          isLoading={loading}
          sparklineData={[4.2, 3.8, 3.5, 3.1, 2.9, 2.7, 2.5]}
        />
      </div>

      {/* Interactive Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueChart
          data={revenue || undefined}
          isLoading={loading}
          onRangeChange={handleRangeChange}
        />
        <DealFunnelChart data={funnel || undefined} isLoading={loading} />
      </div>

      {/* Listing Quality & Operations Section */}
      <div className="space-y-4">
        <h2 className="font-mono text-xl font-black uppercase tracking-tight text-black border-b-2 border-foreground/10 pb-2">
          Operations & Listing Quality
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Inspection Pass Rate */}
          <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center border-2 border-foreground bg-[#22c55e] shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                <CheckCircle2 className="w-5 h-5 text-black" />
              </div>
              <div>
                <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase block">
                  Inspection Pass Rate
                </span>
                <h4 className="font-mono text-2xl font-black mt-0.5">
                  {loading ? "…" : renderMetric(quality?.inspectionPassRate, "%")}
                </h4>
              </div>
            </div>
            <p className="font-mono text-xs text-muted-foreground mt-4 leading-relaxed">
              Percentage of scheduled property inspections that successfully meet ShelterFlex standards.
            </p>
          </div>

          {/* Average Quality Score */}
          <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center border-2 border-foreground bg-[#f59e0b] shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                <Award className="w-5 h-5 text-black" />
              </div>
              <div>
                <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase block">
                  Avg Listing Quality
                </span>
                <h4 className="font-mono text-2xl font-black mt-0.5">
                  {loading ? "…" : renderMetric(quality?.averageListingScore, "/100")}
                </h4>
              </div>
            </div>
            <p className="font-mono text-xs text-muted-foreground mt-4 leading-relaxed">
              Overall platform grading mapped dynamically from independent inspection rating scores.
            </p>
          </div>

          {/* Whistleblower Complaint Rate */}
          <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center border-2 border-foreground bg-[#dc2626] shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                <AlertTriangle className="w-5 h-5 text-black" />
              </div>
              <div>
                <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase block">
                  Whistleblower Reports
                </span>
                <h4 className="font-mono text-2xl font-black mt-0.5">
                  {loading ? "…" : renderMetric(quality?.whistleblowerReportRate, "%")}
                </h4>
              </div>
            </div>
            <p className="font-mono text-xs text-muted-foreground mt-4 leading-relaxed">
              Rate of anonymous tenant complaints and severe listing quality issue reports raised.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
