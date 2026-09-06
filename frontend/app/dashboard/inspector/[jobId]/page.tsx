"use client";

import { useEffect, useState, use, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Clock,
  DollarSign,
  FileText,
  CheckCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { ReportSubmitForm } from "@/components/inspector/ReportSubmitForm";
import { getInspectorJobs, type InspectorJob } from "@/lib/inspectorApi";
import { useFeatureFlag } from "@/lib/featureFlags";
import { formatDate } from "@/lib/date";

export default function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const isEnabled = useFeatureFlag("INSPECTOR_DASHBOARD_ENABLED");
  const [isLoading, setIsLoading] = useState(true);
  const [job, setJob] = useState<InspectorJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReportForm, setShowReportForm] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchJob = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const jobs = await getInspectorJobs();
      const found = jobs.find((j) => j.id === resolvedParams.jobId);
      setJob(found || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load job");
    } finally {
      setIsLoading(false);
    }
  }, [resolvedParams.jobId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  const handleReportSubmitted = () => {
    router.push("/dashboard/inspector");
  };

  const handleReportError = (err: Error) => {
    setSubmitError(err.message);
  };

  if (!isEnabled) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="lg:pl-64">
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="lg:pl-64">
          <div className="p-6 lg:p-8">
            <Skeleton className="mb-8 h-12 w-48 border-3 border-foreground" />
            <Skeleton className="h-96 border-3 border-foreground" />
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="lg:pl-64">
          <div className="p-6 lg:p-8">
            <Link href="/dashboard/inspector">
              <Button variant="outline" className="mb-6 border-2 border-foreground">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Job Board
              </Button>
            </Link>
            <Card className="border-3 border-foreground p-12 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <FileText className="mx-auto h-16 w-16 text-muted-foreground" />
              <h3 className="mt-4 text-xl font-bold text-foreground">
                Failed to load job
              </h3>
              <p className="mt-2 text-muted-foreground">{error}</p>
              <Button
                onClick={fetchJob}
                className="mt-6 border-3 border-foreground bg-primary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="lg:pl-64">
          <div className="p-6 lg:p-8">
            <Link href="/dashboard/inspector">
              <Button
                variant="outline"
                className="mb-6 border-2 border-foreground"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Job Board
              </Button>
            </Link>
            <Card className="border-3 border-foreground p-12 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <FileText className="mx-auto h-16 w-16 text-muted-foreground" />
              <h3 className="mt-4 text-xl font-bold text-foreground">
                Job Not Found
              </h3>
              <p className="mt-2 text-muted-foreground">
                The inspection job you're looking for doesn't exist or is no longer available.
              </p>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  const isCompleted = job.status === "completed";

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
          {/* Header */}
          <div className="mb-8">
            <Link href="/dashboard/inspector">
              <Button
                variant="outline"
                className="mb-4 border-2 border-foreground"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Job Board
              </Button>
            </Link>
            <h1 className="text-3xl font-bold text-foreground">
              {job.propertyTitle}
            </h1>
            <p className="mt-2 text-muted-foreground">{job.address}</p>
          </div>

          {showReportForm ? (
            <div className="space-y-4">
              {submitError && (
                <div className="rounded-lg border-2 border-destructive bg-destructive/10 p-4 text-sm text-destructive">
                  {submitError}
                </div>
              )}
              <ReportSubmitForm
                jobId={job.id}
                propertyTitle={job.propertyTitle}
                onSubmitted={handleReportSubmitted}
                onError={handleReportError}
              />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Job Details Card */}
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-foreground">
                      Job Details
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Job ID: {job.id}
                    </p>
                  </div>
                  <Badge
                    className={`border-2 border-foreground ${
                      job.status === "available"
                        ? "bg-green-500"
                        : job.status === "in_progress"
                        ? "bg-primary"
                        : "bg-muted"
                    }`}
                  >
                    {job.status === "available"
                      ? "Available"
                      : job.status === "in_progress"
                      ? "In Progress"
                      : "Completed"}
                  </Badge>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Inspection Type
                      </p>
                      <p className="font-medium text-foreground">
                        {job.inspectionType === "new_listing"
                          ? "New Listing"
                          : "Re-Inspection"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">Offered Fee</p>
                      <p className="font-medium text-foreground">
                        ₦{job.offeredFee.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">Deadline</p>
                      <p className="font-medium text-foreground">
                        {formatDate(job.deadline)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">Location</p>
                      <p className="font-medium text-foreground">{job.address}</p>
                    </div>
                  </div>
                </div>

                {isCompleted && (
                  <div className="mt-6 flex items-center gap-2 rounded-lg bg-accent p-4 border-2 border-foreground">
                    <CheckCircle className="h-5 w-5 text-foreground" />
                    <div>
                      <p className="font-medium text-foreground">
                        Inspection Completed
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Completed on {formatDate(job.completedAt)}
                      </p>
                    </div>
                  </div>
                )}
              </Card>

              {/* Action Buttons */}
              {!isCompleted && (
                <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <h3 className="text-lg font-bold text-foreground">
                    Actions
                  </h3>
                  <div className="mt-4 flex gap-4">
                    <Button
                      onClick={() => setShowReportForm(true)}
                      className="border-3 border-foreground bg-primary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)]"
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      Start Inspection
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
