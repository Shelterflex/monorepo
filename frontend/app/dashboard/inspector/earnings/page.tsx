"use client";

import { useEffect, useState, useCallback } from "react";
import { DollarSign, CheckCircle, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  EmptyState,
  ErrorState,
  ListRowSkeleton,
  LoadingState,
  MoneyValue,
  StatCardSkeleton,
} from "@/components/ui/data-state";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { propertyInspectionApi, type InspectorEarnings } from "@/lib/propertyInspectionApi";
import { useFeatureFlag } from "@/lib/featureFlags";
import { formatDate } from "@/lib/date";

export default function EarningsPage() {
  const isEnabled = useFeatureFlag("INSPECTOR_DASHBOARD_ENABLED");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<InspectorEarnings | null>(null);

  const fetchEarnings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await propertyInspectionApi.getEarnings();
      setEarnings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load earnings");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEarnings();
  }, [fetchEarnings]);

  // Deliberately `null` rather than `0` when nothing has loaded: a failed fetch
  // used to render "₦0 Total Earned", which is a plausible figure an inspector
  // could act on. Unknown amounts render as a dash via MoneyValue instead.
  const totalEarned = earnings ? earnings.totalEarnings : null;
  const paidAmount = totalEarned; // Approved inspections are paid out in full.
  const pendingAmount = earnings ? 0 : null;

  const moneyStatus: "loading" | "error" | "ready" = isLoading
    ? "loading"
    : error || !earnings
      ? "error"
      : "ready";

  const formatNaira = (amount: number) => `₦${amount.toLocaleString()}`;

  if (!isEnabled) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="lg:pl-64">
          <div className="p-6 lg:p-8">
            <Card className="border-3 border-foreground p-12 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <DollarSign className="mx-auto h-16 w-16 text-muted-foreground" />
              <h3 className="mt-4 text-xl font-bold text-foreground">
                Inspector Dashboard Not Available
              </h3>
              <p className="mt-2 text-muted-foreground">
                The inspector dashboard feature is currently disabled.
              </p>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <DashboardSidebar
        role="inspector"
        userInfo={{ name: "Inspector Chidi", roleLabel: "Property Inspector" }}
      />

      {/* Main Content */}
      <main className="lg:pl-64">
        <div className="p-6 lg:p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Earnings</h1>
            <p className="mt-2 text-muted-foreground">
              Track your completed jobs and payment history
            </p>
          </div>

          {/* Error */}
          {error && !isLoading && (
            <ErrorState
              className="mb-8"
              title="Failed to load earnings"
              description={error}
              onRetry={fetchEarnings}
              retryLabel="Retry"
            />
          )}

          {/* Stats */}
          {isLoading ? (
            <LoadingState
              label="Loading earnings totals"
              className="mb-8 grid gap-4 md:grid-cols-3"
            >
              {[1, 2, 3].map((i) => (
                <StatCardSkeleton key={i} className="h-32" />
              ))}
            </LoadingState>
          ) : (
            <div className="mb-8 grid gap-4 md:grid-cols-3">
              {[
                {
                  label: "Total Earned",
                  amount: totalEarned,
                  icon: DollarSign,
                  iconClass: "bg-primary",
                },
                {
                  label: "Paid",
                  amount: paidAmount,
                  icon: CheckCircle,
                  iconClass: "bg-green-500",
                },
                {
                  label: "Pending",
                  amount: pendingAmount,
                  icon: Clock,
                  iconClass: "bg-accent",
                },
              ].map((stat) => (
                <Card
                  key={stat.label}
                  className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        {stat.label}
                      </p>
                      <p className="mt-2 text-2xl font-bold text-foreground">
                        <MoneyValue
                          status={moneyStatus}
                          amount={stat.amount}
                          format={formatNaira}
                          skeletonClassName="h-8 w-32"
                          unavailableLabel={`${stat.label} unavailable`}
                        />
                      </p>
                    </div>
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-lg ${stat.iconClass}`}
                    >
                      <stat.icon className="h-6 w-6 text-foreground" aria-hidden="true" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Earnings History */}
          <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <h3 className="mb-4 text-lg font-bold text-foreground">
              Earnings History
            </h3>

            {isLoading ? (
              <LoadingState label="Loading earnings history" className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <ListRowSkeleton key={i} />
                ))}
              </LoadingState>
            ) : error || !earnings ? (
              <ErrorState
                title="Earnings history is unavailable"
                description={error ?? "We couldn't reach the inspections service."}
                onRetry={fetchEarnings}
                retryLabel="Retry"
              />
            ) : earnings.inspections.length === 0 ? (
              <EmptyState
                icon={DollarSign}
                title="No earnings yet"
                description="Claim an inspection job and submit your report — approved inspections are paid out here."
                action={{ label: "Find inspection jobs", href: "/dashboard/inspector" }}
              />
            ) : (
              <div className="space-y-4">
                {earnings.inspections.map((inspection) => (
                  <div
                    key={inspection.id}
                    className="flex items-center justify-between rounded-lg border-2 border-foreground bg-card p-4"
                  >
                    <div className="flex-1">
                      <h4 className="font-bold text-foreground">
                        Inspection #{inspection.id.slice(0, 8)}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        Listing ID: {inspection.listingId}
                      </p>
                      <div className="mt-2 flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">
                          Completed: {formatDate(inspection.completedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-lg font-bold text-foreground">
                          <MoneyValue
                            status="ready"
                            amount={inspection.fee}
                            format={formatNaira}
                          />
                        </p>
                        <Badge className="border-2 border-foreground bg-green-500">
                          Paid
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
