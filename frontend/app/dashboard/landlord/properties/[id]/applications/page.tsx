"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Filter,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApplicantCard } from "@/components/landlord/ApplicantCard";
import { ApplicantDetailDrawer } from "@/components/landlord/ApplicantDetailDrawer";
import {
  type LandlordPropertyRecord,
  type LandlordApplicationRecord,
  getLandlordProperty,
  listPropertyApplications,
  reviewPropertyApplication,
} from "@/lib/landlordPropertiesApi";
import { showSuccessToast, showErrorToast } from "@/lib/toast";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";

export default function PropertyApplicationsPage() {
  const params = useParams();
  const propertyId = params.id as string;

  const [property, setProperty] = useState<LandlordPropertyRecord | null>(null);
  const [applications, setApplications] = useState<LandlordApplicationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedApplicant, setSelectedApplicant] = useState<LandlordApplicationRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const prop = await getLandlordProperty(propertyId);
      setProperty(prop);

      if (prop.listingId) {
        const result = await listPropertyApplications(prop.listingId);
        setApplications(result.applications);
      } else {
        setApplications([]);
      }
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredApplications = applications.filter((app) => {
    if (statusFilter === "all") return true;
    return app.status === statusFilter;
  });

  const pendingCount = applications.filter((app) => app.status === "pending").length;

  const handleViewDetails = (applicant: LandlordApplicationRecord) => {
    setSelectedApplicant(applicant);
    setDrawerOpen(true);
  };

  const handleApprove = async (applicantId: string) => {
    try {
      await reviewPropertyApplication(applicantId, "approve");
      showSuccessToast("Application approved.");
      setDrawerOpen(false);
      loadData();
    } catch (error) {
      showErrorToast(error, "Failed to approve application");
    }
  };

  const handleReject = async (applicantId: string) => {
    try {
      await reviewPropertyApplication(applicantId, "reject");
      showSuccessToast("Application rejected.");
      setDrawerOpen(false);
      loadData();
    } catch (error) {
      showErrorToast(error, "Failed to reject application");
    }
  };

  const statusFilters = [
    { value: "all" as const, label: "All", icon: Filter },
    { value: "pending" as const, label: "Pending", icon: Clock },
    { value: "approved" as const, label: "Approved", icon: CheckCircle },
    { value: "rejected" as const, label: "Rejected", icon: XCircle },
  ];

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        role="landlord"
        userInfo={{ name: "Chief Okonkwo", roleLabel: "Landlord" }}
      />

      <main className="lg:ml-64 min-h-screen pt-20">
        <div className="p-8">
          <div className="mb-8">
            <Link
              href="/dashboard/landlord/properties"
              className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Properties
            </Link>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-foreground">
                  Applications for {property?.title || "Property"}
                </h1>
                <p className="mt-1 text-muted-foreground">
                  {isLoading
                    ? "Loading applications…"
                    : `${pendingCount} pending application${pendingCount !== 1 ? "s" : ""} awaiting review`}
                </p>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card
                  key={`app-skeleton-${i}`}
                  className="border-3 border-foreground p-6 animate-pulse"
                >
                  <div className="h-6 w-48 rounded bg-muted" />
                  <div className="mt-3 h-4 w-64 rounded bg-muted" />
                </Card>
              ))}
            </div>
          ) : loadError ? (
            <Card className="border-3 border-foreground bg-destructive/10 p-12 text-center">
              <AlertTriangle className="mx-auto h-16 w-16 text-destructive" />
              <h3 className="mt-4 text-xl font-bold">Applications unavailable</h3>
              <p className="mt-2 text-muted-foreground">
                Could not load applications. Please try again.
              </p>
              <Button
                onClick={loadData}
                className="mt-6 border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              >
                Retry
              </Button>
            </Card>
          ) : !property?.listingId ? (
            <Card className="border-3 border-foreground p-12 text-center">
              <Building2 className="mx-auto h-16 w-16 text-muted-foreground" />
              <h3 className="mt-4 text-xl font-bold">Not yet listed</h3>
              <p className="mt-2 text-muted-foreground">
                This property has not been approved for listing yet. Applications
                will appear here once the listing is live.
              </p>
            </Card>
          ) : (
            <>
              <div className="mb-6 flex flex-wrap gap-2">
                {statusFilters.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value)}
                    className={`flex items-center gap-2 border-3 border-foreground px-4 py-2 font-bold ${
                      statusFilter === value
                        ? "bg-foreground text-background"
                        : "bg-card hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                    {value === "pending" && pendingCount > 0 && (
                      <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs font-bold text-destructive-foreground">
                        {pendingCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                {filteredApplications.length === 0 ? (
                  <Card className="border-3 border-foreground p-12 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    <Building2 className="mx-auto h-16 w-16 text-muted-foreground" />
                    <h3 className="mt-4 text-xl font-bold">No applications found</h3>
                    <p className="mt-2 text-muted-foreground">
                      {statusFilter === "all"
                        ? "There are no applications for this property yet."
                        : `There are no ${statusFilter} applications.`}
                    </p>
                  </Card>
                ) : (
                  filteredApplications.map((applicant) => (
                    <ApplicantCard
                      key={applicant.id}
                      applicant={applicant}
                      onViewDetails={handleViewDetails}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </main>

      <ApplicantDetailDrawer
        applicant={selectedApplicant}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
