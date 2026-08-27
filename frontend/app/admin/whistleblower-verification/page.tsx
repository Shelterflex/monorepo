"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Eye,
  Loader2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/date";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "";

type ApplicationStatus = "pending" | "approved" | "rejected";
type FilterStatus = ApplicationStatus | "all";

interface WhistleblowerApplication {
  applicationId: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  linkedinProfile: string;
  facebookProfile: string;
  instagramProfile: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
  socialScore: number;
  greenFlags: string[];
  redFlags: string[];
}

function getStatusBgClass(status: ApplicationStatus): string {
  if (status === "pending") return "bg-accent";
  if (status === "approved") return "bg-secondary";
  return "bg-destructive";
}

export default function WhistleblowerVerificationPanel() {
  const [applications, setApplications] = useState<WhistleblowerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("pending");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const selectedApplication = selectedApplicationId
    ? applications.find((application) => application.applicationId === selectedApplicationId) ?? null
    : null;

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const statusParam = filterStatus === "all" ? "" : `?status=${filterStatus}`;
      const response = await fetch(
        `${API_BASE_URL}/api/admin/whistleblower-applications${statusParam}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to fetch applications");
      }

      const nextApplications = data.applications as WhistleblowerApplication[];
      setApplications(nextApplications);
      setSelectedApplicationId((current) => {
        if (current && nextApplications.some((application) => application.applicationId === current)) {
          return current;
        }
        return nextApplications[0]?.applicationId ?? null;
      });
    } catch (fetchError) {
      setApplications([]);
      setSelectedApplicationId(null);
      setError(
        fetchError instanceof Error ? fetchError.message : "Failed to load applications"
      );
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    void fetchApplications();
  }, [fetchApplications]);

  async function handleApprove(applicationId: string) {
    setActionLoading(applicationId);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/admin/whistleblower-applications/${applicationId}/approve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reviewedBy: "admin" }),
        }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to approve application");
      }

      await fetchApplications();
    } catch (approveError) {
      setError(
        approveError instanceof Error ? approveError.message : "Failed to approve application"
      );
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(applicationId: string) {
    const reason = window.prompt("Enter rejection reason:");
    if (!reason) {
      return;
    }

    setActionLoading(applicationId);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/admin/whistleblower-applications/${applicationId}/reject`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reviewedBy: "admin", reason }),
        }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to reject application");
      }

      await fetchApplications();
    } catch (rejectError) {
      setError(
        rejectError instanceof Error ? rejectError.message : "Failed to reject application"
      );
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-3 border-foreground bg-card p-4 md:p-6">
        <div className="container mx-auto">
          <h1 className="text-2xl font-black md:text-3xl">
            Whistleblower Verification Panel
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review and approve or reject whistleblower applications
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <div className="mb-4 border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <p className="mb-3 block text-sm font-bold">Filter by Status</p>
              <div className="grid grid-cols-2 gap-2">
                {["pending", "approved", "rejected", "all"].map((status) => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status as FilterStatus)}
                    className={`border-2 border-foreground p-2 text-xs font-bold transition-all ${
                      filterStatus === status
                        ? "bg-primary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                        : "bg-card"
                    }`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="mb-4 border-3 border-destructive bg-red-50 p-4">
                <p className="text-sm text-destructive">{error}</p>
                <Button onClick={() => void fetchApplications()} variant="outline" className="mt-2">
                  Retry
                </Button>
              </div>
            )}

            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : applications.length === 0 ? (
              <Card className="border-3 border-foreground p-6 text-center shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                <p className="font-bold">No applications found</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try a different status filter to review historical decisions.
                </p>
              </Card>
            ) : (
              <div className="max-h-[70vh] space-y-3 overflow-y-auto">
                {applications.map((application) => (
                  <Card
                    key={application.applicationId}
                    onClick={() => setSelectedApplicationId(application.applicationId)}
                    className={`cursor-pointer border-3 border-foreground p-3 transition-all ${
                      selectedApplicationId === application.applicationId
                        ? "bg-primary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                        : "bg-card shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-bold">{application.fullName}</p>
                        <p className="text-xs text-muted-foreground">{application.address}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(application.createdAt)}
                        </p>
                      </div>
                      {application.status === "pending" && (
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      )}
                      {application.status === "approved" && (
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                      )}
                      {application.status === "rejected" && (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            {selectedApplication ? (
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <h2 className="text-2xl font-black">{selectedApplication.fullName}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedApplication.address}
                    </p>
                  </div>
                  <div
                    className={`border-2 border-foreground px-3 py-1 text-sm font-bold ${getStatusBgClass(
                      selectedApplication.status
                    )}`}
                  >
                    {selectedApplication.status.toUpperCase()}
                  </div>
                </div>

                <div className="mb-6 border-3 border-foreground bg-muted p-4">
                  <p className="mb-3 text-xs font-bold text-muted-foreground">CONTACT INFO</p>
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="font-bold">Email:</span> {selectedApplication.email}
                    </p>
                    <p>
                      <span className="font-bold">Phone:</span> {selectedApplication.phone}
                    </p>
                    <p>
                      <span className="font-bold">Applied:</span>{" "}
                      {formatDate(selectedApplication.createdAt)}
                    </p>
                    {selectedApplication.reviewedAt && (
                      <p>
                        <span className="font-bold">Reviewed:</span>{" "}
                        {formatDate(selectedApplication.reviewedAt)}
                      </p>
                    )}
                    {selectedApplication.reviewedBy && (
                      <p>
                        <span className="font-bold">Reviewer:</span>{" "}
                        {selectedApplication.reviewedBy}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mb-6 border-3 border-foreground bg-card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-bold">SOCIAL VERIFICATION SCORE</p>
                    <div className="flex h-10 w-10 items-center justify-center border-3 border-foreground bg-secondary font-bold">
                      {selectedApplication.socialScore}
                    </div>
                  </div>
                  <div className="h-2 w-full border-2 border-foreground bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${selectedApplication.socialScore}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Score above 70 = generally safe • Below 30 = likely fraud
                  </p>
                </div>

                {selectedApplication.greenFlags.length > 0 && (
                  <div className="mb-6 border-3 border-secondary bg-green-50 p-4">
                    <p className="mb-2 flex items-center gap-2 text-sm font-bold text-secondary">
                      <CheckCircle className="h-4 w-4" />
                      VERIFIED SIGNALS
                    </p>
                    <ul className="space-y-2">
                      {selectedApplication.greenFlags.map((flag) => (
                        <li
                          key={`green-${flag}`}
                          className="flex gap-2 text-xs text-secondary"
                        >
                          <span className="mt-0.5">✓</span>
                          <span>{flag}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedApplication.redFlags.length > 0 && (
                  <div className="mb-6 border-3 border-destructive bg-red-50 p-4">
                    <p className="mb-2 flex items-center gap-2 text-sm font-bold text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      RED FLAGS
                    </p>
                    <ul className="space-y-2">
                      {selectedApplication.redFlags.map((flag) => (
                        <li key={`red-${flag}`} className="flex gap-2 text-xs text-destructive">
                          <span className="mt-0.5">!</span>
                          <span>{flag}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mb-6 border-3 border-foreground p-4">
                  <p className="mb-3 text-xs font-bold text-muted-foreground">
                    SOCIAL PROFILES (Click to verify)
                  </p>
                  <div className="space-y-2">
                    <a
                      href={selectedApplication.linkedinProfile}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 border-b border-foreground pb-2 text-sm font-bold text-primary hover:underline"
                    >
                      <Eye className="h-4 w-4" />
                      LinkedIn Profile
                    </a>
                    <a
                      href={selectedApplication.facebookProfile}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 border-b border-foreground pb-2 text-sm font-bold text-primary hover:underline"
                    >
                      <Eye className="h-4 w-4" />
                      Facebook Profile
                    </a>
                    <a
                      href={selectedApplication.instagramProfile}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm font-bold text-primary hover:underline"
                    >
                      <Eye className="h-4 w-4" />
                      Instagram Profile
                    </a>
                  </div>
                </div>

                {selectedApplication.rejectionReason && (
                  <div className="mb-6 border-3 border-destructive bg-red-50 p-4">
                    <p className="text-sm font-bold text-destructive">Rejection reason</p>
                    <p className="mt-2 text-sm text-destructive/80">
                      {selectedApplication.rejectionReason}
                    </p>
                  </div>
                )}

                {selectedApplication.status === "pending" && (
                  <div className="flex gap-3">
                    <Button
                      onClick={() => void handleApprove(selectedApplication.applicationId)}
                      disabled={actionLoading === selectedApplication.applicationId}
                      className="flex-1 border-3 border-foreground bg-secondary px-6 py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
                    >
                      {actionLoading === selectedApplication.applicationId ? (
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      ) : (
                        <CheckCircle className="mr-2 h-5 w-5" />
                      )}
                      Approve
                    </Button>
                    <Button
                      onClick={() => void handleReject(selectedApplication.applicationId)}
                      disabled={actionLoading === selectedApplication.applicationId}
                      className="flex-1 border-3 border-destructive bg-transparent px-6 py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
                    >
                      {actionLoading === selectedApplication.applicationId ? (
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      ) : (
                        <XCircle className="mr-2 h-5 w-5" />
                      )}
                      Reject
                    </Button>
                  </div>
                )}
              </Card>
            ) : (
              <Card className="border-3 border-foreground p-10 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <p className="text-lg font-bold">Select an application</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Choose an applicant from the list to review their identity signals.
                </p>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
