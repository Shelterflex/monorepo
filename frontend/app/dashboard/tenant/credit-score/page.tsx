"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Gauge,
  Clock,
  ArrowRight,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CreditScoreGauge } from "@/components/tenant/CreditScoreGauge";
import { ScoreFactorList } from "@/components/tenant/ScoreFactorList";
import { ScoreImprovementTips } from "@/components/tenant/ScoreImprovementTips";
import dynamic from "next/dynamic";

const ScoreHistoryChart = dynamic(
  () =>
    import("@/components/tenant/ScoreHistoryChart").then((m) => ({
      default: m.ScoreHistoryChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 w-full md:h-72 animate-pulse rounded bg-muted" />
    ),
  },
);
import {
  getMyCreditScore,
  getMyCreditScoreHistory,
  type CreditScoreSnapshot,
  type ScoreHistoryPoint,
} from "@/lib/creditScoreApi";
import { ApiError } from "@/lib/apiClient";
import { formatMonthYear } from "@/lib/date";

interface CreditScoreProfile {
  score: number;
  band: "Poor" | "Fair" | "Good" | "Excellent";
  factors: { name: string; status: "pass" | "fail" | "warn"; weight: number; detail: string }[];
  history: ScoreHistoryPoint[];
  tips: string[];
}

function formatHistoryDate(isoDate: string): string {
  return formatMonthYear(isoDate);
}

function mapSnapshotToProfile(
  snapshot: CreditScoreSnapshot,
  historyData: { score: number; band: string; computedAt: string }[],
): CreditScoreProfile {
  return {
    score: snapshot.score,
    band: snapshot.band,
    factors: snapshot.factors,
    history: historyData.map((h) => ({
      month: formatHistoryDate(h.computedAt),
      score: h.score,
    })),
    tips: snapshot.tips,
  };
}

function CreditScoreSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <div className="mb-6 h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="flex h-48 items-center justify-center">
          <div className="h-32 w-32 animate-pulse rounded-full bg-muted" />
        </div>
      </Card>
      <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <div className="mb-4 h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded bg-muted" />
      </Card>
      <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </Card>
      <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <div className="mb-4 h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </Card>
    </div>
  );
}

function PendingView() {
  return (
    <Card className="border-3 border-foreground p-8 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-12">
      <Clock className="mx-auto h-16 w-16 text-muted-foreground" />
      <h2 className="mt-4 font-mono text-xl font-bold">
        Assessment in progress
      </h2>
      <p className="mx-auto mt-2 max-w-md text-muted-foreground">
        Your underwriting review has not completed yet. We will notify
        you once your credit score is ready.
      </p>
      <Link href="/onboarding">
        <Button className="mt-6 border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          Complete onboarding
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </Link>
    </Card>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-3 border-foreground p-8 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-12">
      <AlertCircle className="mx-auto h-16 w-16 text-destructive" />
      <h2 className="mt-4 font-mono text-xl font-bold">
        Unable to load credit score
      </h2>
      <p className="mx-auto mt-2 max-w-md text-muted-foreground">
        {message}
      </p>
      <Button
        onClick={onRetry}
        className="mt-6 border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
      >
        <RefreshCw className="mr-2 h-4 w-4" />
        Try again
      </Button>
    </Card>
  );
}

function CreditScoreContent() {
  const searchParams = useSearchParams();
  const isPending = searchParams.get("pending") === "1";

  const [profile, setProfile] = useState<CreditScoreProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchScore = async () => {
    setLoading(true);
    setError(null);
    try {
      const [snapshot, historyResponse] = await Promise.all([
        getMyCreditScore(),
        getMyCreditScoreHistory(),
      ]);
      setProfile(mapSnapshotToProfile(snapshot, historyResponse.history));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setProfile(null);
      } else {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isPending) {
      fetchScore();
    } else {
      setLoading(false);
    }
  }, [isPending]);

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <DashboardSidebar
        role="tenant"
        userInfo={{ name: "Tenant", roleLabel: "Tenant" }}
      />

      <main className="min-h-screen pt-20 lg:ml-64">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="mb-6 md:mb-8">
            <h1 className="text-2xl font-bold text-foreground md:text-3xl lg:text-4xl">
              Credit Score Profile
            </h1>
            <p className="mt-2 text-sm text-muted-foreground md:text-base">
              Understand your tenant risk score and how to improve it.
            </p>
          </div>

          {isPending || (!loading && profile === null && !error) ? (
            <PendingView />
          ) : loading ? (
            <CreditScoreSkeleton />
          ) : error ? (
            <ErrorView message={error} onRetry={fetchScore} />
          ) : profile ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h2 className="mb-6 font-mono text-lg font-bold">
                  Current Score
                </h2>
                <CreditScoreGauge score={profile.score} band={profile.band} />
              </Card>

              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h2 className="mb-4 font-mono text-lg font-bold">
                  Score History
                </h2>
                <ScoreHistoryChart history={profile.history} />
              </Card>

              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] lg:col-span-0">
                <h2 className="mb-4 font-mono text-lg font-bold">
                  Contributing Factors
                </h2>
                <ScoreFactorList factors={profile.factors} />
              </Card>

              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h2 className="mb-4 font-mono text-lg font-bold">
                  How to Improve
                </h2>
                <ScoreImprovementTips tips={profile.tips} />
              </Card>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export default function TenantCreditScorePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <p className="font-mono text-muted-foreground">Loading score...</p>
        </div>
      }
    >
      <CreditScoreContent />
    </Suspense>
  );
}
