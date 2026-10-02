"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  FileText,
  DollarSign,
  CheckCircle,
  Building2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  StatCardSkeleton,
} from "@/components/ui/data-state";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { JobCard } from "@/components/inspector/JobCard";
import { propertyInspectionApi, type InspectionJob } from "@/lib/propertyInspectionApi";
import { useFeatureFlag } from "@/lib/featureFlags";

export default function InspectorDashboard() {
  const isEnabled = useFeatureFlag("INSPECTOR_DASHBOARD_ENABLED");
  const [isLoading, setIsLoading] = useState(true);
  const [jobs, setJobs] = useState<InspectionJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "available" | "in_progress" | "completed">(
    "all",
  );

  const fetchJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await propertyInspectionApi.getAvailableJobs();
      setJobs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const filteredJobs = jobs.filter((job) => {
    if (filter === "all") return true;
    if (filter === "available") return job.status === "available";
    if (filter === "in_progress")
      return job.status === "claimed" || job.status === "in_progress";
    if (filter === "completed") return job.status === "completed";
    return true;
  });

  const handleClaimJob = async (jobId: string) => {
    setClaimingId(jobId);
    try {
      const claimed = await propertyInspectionApi.acceptJob(jobId);
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? claimed : j)),
      );
    } catch (err) {
      console.error("Failed to claim job:", err);
    } finally {
      setClaimingId(null);
    }
  };

  const availableCount = jobs.filter((j) => j.status === "available").length;
  const inProgressCount = jobs.filter(
    (j) => j.status === "claimed" || j.status === "in_progress",
  ).length;
  const completedCount = jobs.filter((j) => j.status === "completed").length;
  const totalEarnings = jobs
    .filter((j) => j.status === "completed")
    .reduce((sum, j) => sum + (j.offeredFee || 0), 0);

  const stats = [
    { label: "Available Jobs", value: String(availableCount), icon: Building2, color: "bg-primary" },
    { label: "In Progress", value: String(inProgressCount), icon: FileText, color: "bg-secondary" },
    { label: "Completed", value: String(completedCount), icon: CheckCircle, color: "bg-accent" },
    { label: "Total Earnings", value: `₦${totalEarnings.toLocaleString()}`, icon: DollarSign, color: "bg-primary" },
  ];

  if (!isEnabled) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main id="main-content" className="lg:pl-64">
          <div className="p-6 lg:p-8">
            <Card className="border-3 border-foreground p-12 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <FileText className="mx-auto h-16 w-16 text-muted-foreground" />
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
      <main id="main-content" className="lg:pl-64">
        <div className="p-6 lg:p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Inspector Dashboard</h1>
            <p className="mt-2 text-muted-foreground">
              Manage your inspection jobs and track your earnings
            </p>
          </div>

          {/* Error */}
          {error && !isLoading && (
            <ErrorState
              className="mb-8"
              title="Failed to load inspection jobs"
              description={error}
              onRetry={fetchJobs}
              retryLabel="Retry"
            />
          )}

          {/* Stats */}
          {isLoading ? (
            <LoadingState
              label="Loading inspection stats"
              className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4"
            >
              {[1, 2, 3, 4].map((i) => (
                <StatCardSkeleton key={i} className="h-32" />
              ))}
            </LoadingState>
          ) : (
            <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {stats.map((stat, index) => {
                const Icon = stat.icon;
                return (
                  <Card
                    key={index}
                    className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">
                          {stat.label}
                        </p>
                        <p className="mt-2 text-2xl font-bold text-foreground">
                          {stat.value}
                        </p>
                      </div>
                      <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${stat.color}`}>
                        <Icon className="h-6 w-6 text-foreground" />
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Filter Tabs */}
          <div className="mb-6 flex gap-2">
            <Button
              variant={filter === "all" ? "default" : "outline"}
              onClick={() => setFilter("all")}
              className={`border-2 ${filter === "all" ? "border-foreground bg-primary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]" : "border-foreground"}`}
            >
              All Jobs
            </Button>
            <Button
              variant={filter === "available" ? "default" : "outline"}
              onClick={() => setFilter("available")}
              className={`border-2 ${filter === "available" ? "border-foreground bg-primary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]" : "border-foreground"}`}
            >
              Available
            </Button>
            <Button
              variant={filter === "in_progress" ? "default" : "outline"}
              onClick={() => setFilter("in_progress")}
              className={`border-2 ${filter === "in_progress" ? "border-foreground bg-primary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]" : "border-foreground"}`}
            >
              In Progress
            </Button>
            <Button
              variant={filter === "completed" ? "default" : "outline"}
              onClick={() => setFilter("completed")}
              className={`border-2 ${filter === "completed" ? "border-foreground bg-primary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]" : "border-foreground"}`}
            >
              Completed
            </Button>
          </div>

          {/* Job Board */}
          {isLoading ? (
            <LoadingState
              label="Loading inspection jobs"
              className="grid gap-6 md:grid-cols-2"
            >
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-48 border-3 border-foreground" />
              ))}
            </LoadingState>
          ) : filteredJobs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No jobs found"
              description={
                filter === "all"
                  ? "There are no inspection jobs available right now. New jobs appear as landlords list properties — check back shortly."
                  : `No ${filter.replace("_", " ")} jobs. Switch to "All Jobs" to see everything on the board.`
              }
              action={
                filter === "all"
                  ? { label: "Refresh job board", onClick: fetchJobs }
                  : { label: "Show all jobs", onClick: () => setFilter("all") }
              }
            />
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {filteredJobs.map((job) => (
                <JobCard key={job.id} job={job} onClaim={handleClaimJob} isClaiming={claimingId === job.id} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
