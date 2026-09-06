"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import { Download, Trash2, Loader2, CheckCircle, AlertCircle, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import useAuthStore from "@/store/useAuthStore";
import { formatDate } from "@/lib/date";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

type ExportStatus = "pending" | "processing" | "ready" | "expired";

interface ExportJob {
  jobId: string;
  status: ExportStatus;
  downloadUrl?: string;
  expiresAt?: string;
}

const STATUS_CONFIG: Record<ExportStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "Queued", color: "bg-blue-100 text-blue-800 border-blue-300", icon: <Clock className="h-3 w-3" /> },
  processing: { label: "Processing", color: "bg-yellow-100 text-yellow-800 border-yellow-300", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  ready: { label: "Ready", color: "bg-green-100 text-green-800 border-green-300", icon: <CheckCircle className="h-3 w-3" /> },
  expired: { label: "Expired", color: "bg-gray-100 text-gray-600 border-gray-300", icon: <AlertCircle className="h-3 w-3" /> },
};

export default function TenantPrivacyPage() {
  const token = useAuthStore((s) => s.token);

  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [isRequestingExport, setIsRequestingExport] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [erasureSubmitted, setErasureSubmitted] = useState(false);
  const [isRequestingErasure, setIsRequestingErasure] = useState(false);
  const [erasureError, setErasureError] = useState<string | null>(null);
  const [erasureConfirmBy, setErasureConfirmBy] = useState<string | null>(null);
  const [showErasureConfirm, setShowErasureConfirm] = useState(false);

  const pollExportStatus = useCallback(async (jobId: string) => {
    setIsPolling(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/tenant/data-export/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json() as { status: ExportStatus; downloadUrl?: string; expiresAt?: string };
      setExportJob((prev) => prev ? { ...prev, status: data.status, downloadUrl: data.downloadUrl, expiresAt: data.expiresAt } : null);
    } catch {
      /* silent */
    } finally {
      setIsPolling(false);
    }
  }, [token]);

  useEffect(() => {
    if (!exportJob || exportJob.status === "ready" || exportJob.status === "expired") return;
    const interval = setInterval(() => {
      pollExportStatus(exportJob.jobId);
    }, 5000);
    return () => clearInterval(interval);
  }, [exportJob, pollExportStatus]);

  const handleRequestExport = async () => {
    setIsRequestingExport(true);
    setExportError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/tenant/data-export/request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json() as { jobId?: string; status?: ExportStatus; message?: string; error?: { message?: string } };

      if (!res.ok) {
        setExportError(data?.error?.message || data?.message || "Failed to request data export.");
        return;
      }

      setExportJob({ jobId: data.jobId!, status: data.status || "pending" });
    } catch {
      setExportError("Network error. Please try again.");
    } finally {
      setIsRequestingExport(false);
    }
  };

  const handleErasureRequest = async () => {
    setIsRequestingErasure(true);
    setErasureError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/tenant/erasure/request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json() as { requestId?: string; confirmBy?: string; message?: string; error?: { message?: string } };

      if (!res.ok) {
        setErasureError(data?.error?.message || data?.message || "Failed to submit erasure request.");
        return;
      }

      setErasureSubmitted(true);
      setErasureConfirmBy(data.confirmBy || null);
      setShowErasureConfirm(false);
    } catch {
      setErasureError("Network error. Please try again.");
    } finally {
      setIsRequestingErasure(false);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <section className="border-b-3 border-foreground bg-muted py-12 md:py-16">
        <div className="container mx-auto px-4">
          <h1 className="font-mono text-3xl font-black md:text-4xl mb-2">
            My Data & Privacy
          </h1>
          <p className="text-muted-foreground">
            Manage your personal data in accordance with the Nigeria Data Protection Act (NDPA).
          </p>
        </div>
      </section>

      <section className="py-12">
        <div className="container mx-auto px-4 max-w-2xl space-y-6">
          {/* Data Export */}
          <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <div className="flex items-start gap-4 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center border-3 border-foreground bg-secondary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-mono text-xl font-black">Request Data Export</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Download a copy of all your personal data: profile, applications, payment history, and document references.
                </p>
              </div>
            </div>

            {exportJob ? (
              <div className="border-3 border-foreground bg-muted p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">Export Status</span>
                  <Badge className={`border text-xs font-bold flex items-center gap-1 ${STATUS_CONFIG[exportJob.status].color}`}>
                    {STATUS_CONFIG[exportJob.status].icon}
                    {STATUS_CONFIG[exportJob.status].label}
                  </Badge>
                </div>

                {(exportJob.status === "pending" || exportJob.status === "processing") && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Your export is being prepared… this may take a few minutes.</span>
                  </div>
                )}

                {exportJob.status === "ready" && exportJob.downloadUrl && (
                  <>
                    <a
                      href={exportJob.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <Button className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                        <Download className="mr-2 h-4 w-4" />
                        Download Export (.zip)
                      </Button>
                    </a>
                    {exportJob.expiresAt && (
                      <p className="text-xs text-muted-foreground">
                        Link expires:{" "}
                        {new Date(exportJob.expiresAt).toLocaleString("en-NG", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    )}
                  </>
                )}

                {exportJob.status === "expired" && (
                  <p className="text-sm text-muted-foreground">
                    This export has expired. Request a new one below.
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => pollExportStatus(exportJob.jobId)}
                    disabled={isPolling}
                    className="border-2 border-foreground text-xs font-bold"
                    aria-label="Refresh export status"
                  >
                    <RefreshCw className={`mr-1 h-3 w-3 ${isPolling ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                  {(exportJob.status === "expired") && (
                    <Button
                      size="sm"
                      onClick={() => setExportJob(null)}
                      className="border-2 border-foreground text-xs font-bold"
                    >
                      Request New Export
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {exportError && (
                  <div role="alert" className="flex items-center gap-2 border-2 border-destructive bg-red-50 p-3 mb-4">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    <p className="text-sm text-destructive font-bold">{exportError}</p>
                  </div>
                )}
                <Button
                  onClick={handleRequestExport}
                  disabled={isRequestingExport}
                  className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-60"
                  aria-label="Request data export"
                >
                  {isRequestingExport ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Requesting…</>
                  ) : (
                    <><Download className="mr-2 h-4 w-4" />Request Data Export</>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Your export will be ready within a few minutes. The download link expires after 48 hours.
                </p>
              </>
            )}
          </Card>

          {/* Account Deletion */}
          <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <div className="flex items-start gap-4 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center border-3 border-foreground bg-destructive/10 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h2 className="font-mono text-xl font-black">Request Account Deletion</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Exercise your right to erasure under the NDPA. An administrator will review and
                  confirm within 30 days.
                </p>
              </div>
            </div>

            {erasureSubmitted ? (
              <div className="border-3 border-foreground bg-muted p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <p className="font-bold">Erasure Request Submitted</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Your request has been logged. An administrator will review and complete the deletion.
                  {erasureConfirmBy && (
                    <> Expected by:{" "}
                      <strong>
                        {formatDate(erasureConfirmBy, { dateStyle: "long" })}
                      </strong>
                    </>
                  )}
                </p>
              </div>
            ) : (
              <>
                <div className="border-2 border-destructive bg-red-50 p-3 mb-4">
                  <p className="text-sm text-destructive font-bold">Warning</p>
                  <p className="text-xs text-destructive mt-1">
                    This action cannot be undone. Active deals must complete before your data can be deleted.
                    All your profile, applications, and payment history will be permanently removed.
                  </p>
                </div>

                {erasureError && (
                  <div role="alert" className="flex items-center gap-2 border-2 border-destructive bg-red-50 p-3 mb-4">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    <p className="text-sm text-destructive font-bold">{erasureError}</p>
                  </div>
                )}

                {!showErasureConfirm ? (
                  <Button
                    onClick={() => setShowErasureConfirm(true)}
                    variant="outline"
                    className="border-3 border-destructive text-destructive font-bold hover:bg-destructive hover:text-white"
                    aria-label="Request account deletion"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Request Account Deletion
                  </Button>
                ) : (
                  <div className="border-3 border-foreground bg-muted p-4 space-y-3">
                    <p className="text-sm font-bold">Are you sure you want to permanently delete your account?</p>
                    <div className="flex gap-3">
                      <Button
                        onClick={handleErasureRequest}
                        disabled={isRequestingErasure}
                        className="border-3 border-foreground bg-destructive text-white font-bold disabled:opacity-60"
                        aria-label="Confirm account deletion request"
                      >
                        {isRequestingErasure ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</>
                        ) : "Yes, Delete My Account"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setShowErasureConfirm(false)}
                        className="border-3 border-foreground font-bold"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>

          <div className="border-3 border-foreground bg-muted p-4">
            <p className="text-xs text-muted-foreground">
              <strong>NDPA Compliance:</strong> Your data rights are protected under Nigeria&apos;s Data Protection Act.
              For questions or concerns, contact{" "}
              <a href="mailto:privacy@shelterflex.com" className="text-primary underline">
                privacy@shelterflex.com
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
