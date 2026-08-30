"use client";

/**
 * Background job health panel (#1449, #1448)
 *
 * Reads GET /api/admin/jobs/health. The state an operator most needs to see is
 * "overdue" — a job that has silently stopped being scheduled produces no error,
 * so it has to be surfaced as an absence.
 */

import { useCallback, useEffect, useState, startTransition } from "react";
import { AlertTriangle, CheckCircle2, Clock, Timer, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type JobState = "healthy" | "failing" | "overdue" | "never_ran";

interface JobRun {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: "completed" | "failed" | "skipped_overrun";
  recordsProcessed: number;
  correlationId: string | null;
  error?: string;
}

interface JobHealth {
  name: string;
  module: string;
  does: string;
  expectedIntervalMs: number;
  ifItDoesNotRun: string;
  healthy: string;
  state: JobState;
  overdue: boolean;
  secondsSinceLastRun: number | null;
  lastRun: JobRun | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

interface JobHealthReport {
  capturedAt: string;
  overdueCount: number;
  failingCount: number;
  jobs: JobHealth[];
}
const REFRESH_INTERVAL_MS = 15_000;

async function fetchJobHealth(): Promise<JobHealthReport> {
  const res = await fetch(`/api/admin/jobs/health`);
  if (!res.ok) throw new Error(`Job health failed: ${res.status}`);
  return res.json();
}

function formatInterval(ms: number): string {
  if (ms >= 86_400_000) return `${Math.round(ms / 86_400_000)}d`;
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`;
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function formatElapsed(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function StateBadge({ state }: { state: JobState }) {
  if (state === "healthy") {
    return (
      <Badge variant="default" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> healthy
      </Badge>
    );
  }
  if (state === "failing") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> failing
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="h-3 w-3" />
      {state === "never_ran" ? "never ran" : "overdue"}
    </Badge>
  );
}

function JobRow({ job }: { job: JobHealth }) {
  const attention = job.state !== "healthy";
  return (
    <div
      data-testid="job-health-row"
      data-job={job.name}
      data-state={job.state}
      className={`py-3 border-b border-border last:border-0 ${attention ? "bg-red-50/50" : ""}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-sm font-semibold">{job.name}</span>
        <StateBadge state={job.state} />
        <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
          <Timer className="h-3 w-3" /> every {formatInterval(job.expectedIntervalMs)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{job.does}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3 w-3" /> last run{" "}
          <span className="text-foreground font-medium">{formatElapsed(job.secondsSinceLastRun)}</span>
        </span>
        {job.lastRun && (
          <>
            <span className="text-muted-foreground">
              duration <span className="text-foreground font-medium">{job.lastRun.durationMs}ms</span>
            </span>
            <span className="text-muted-foreground">
              processed{" "}
              <span className="text-foreground font-medium">{job.lastRun.recordsProcessed}</span>
            </span>
            {job.lastRun.correlationId && (
              <span className="text-muted-foreground font-mono">
                correlation {job.lastRun.correlationId}
              </span>
            )}
          </>
        )}
        {job.consecutiveFailures > 0 && (
          <span className="text-red-600 font-medium">
            {job.consecutiveFailures} consecutive failure(s)
          </span>
        )}
      </div>
      {job.lastRun?.error && (
        <p className="mt-1 text-xs text-red-700 font-mono break-all">{job.lastRun.error}</p>
      )}
      {attention && (
        <p className="mt-1 text-xs text-red-700">Impact if it stays down: {job.ifItDoesNotRun}</p>
      )}
    </div>
  );
}

export default function JobHealthPanel() {
  const [report, setReport] = useState<JobHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReport(await fetchJobHealth());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
    const id = setInterval(
      () =>
        startTransition(() => {
          void load();
        }),
      REFRESH_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [load]);

  return (
    <Card data-testid="job-health-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Timer className="h-4 w-4" /> Background jobs
          {report && report.overdueCount > 0 && (
            <Badge variant="destructive" className="ml-auto">
              {report.overdueCount} overdue
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-red-700 flex items-center gap-2" role="alert">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        )}
        {!error && !report && (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
        {!error && report && report.jobs.map((job) => <JobRow key={job.name} job={job} />)}
      </CardContent>
    </Card>
  );
}
