"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import useAuthStore from "@/store/useAuthStore";
import { AlertCircle, ChevronDown, Loader2, RefreshCw, Shield } from "lucide-react";
import { formatDate } from "@/lib/date";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

type ReportStatus = "new" | "under_investigation" | "resolved" | "dismissed";
type ReportType = "fake_listing" | "fraudulent_landlord" | "rent_scam" | "other";

interface WhistleblowerReport {
  id: string;
  referenceCode: string;
  reportType: ReportType;
  description: string;
  evidenceUrl?: string;
  status: ReportStatus;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<ReportStatus, string> = {
  new: "bg-blue-100 text-blue-800 border-blue-300",
  under_investigation: "bg-yellow-100 text-yellow-800 border-yellow-300",
  resolved: "bg-green-100 text-green-800 border-green-300",
  dismissed: "bg-gray-100 text-gray-600 border-gray-300",
};

const TYPE_LABELS: Record<ReportType, string> = {
  fake_listing: "Fake Listing",
  fraudulent_landlord: "Fraudulent Landlord",
  rent_scam: "Rent Scam",
  other: "Other",
};

export default function AdminReportsPage() {
  const token = useAuthStore((s) => s.token);

  const [reports, setReports] = useState<WhistleblowerReport[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updateForm, setUpdateForm] = useState<{ status: string; note: string }>({ status: "", note: "" });

  const fetchReports = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterType) params.set("type", filterType);
      if (filterStatus) params.set("status", filterStatus);
      params.set("page", String(page));

      const res = await fetch(`${API_BASE}/api/v1/reports/admin/reports?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        setError(res.status === 403 ? "Access denied. Admin role required." : "Failed to load reports.");
        return;
      }

      const data = await res.json() as { reports: WhistleblowerReport[]; total: number };
      setReports(data.reports || []);
      setTotal(data.total || 0);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [token, filterType, filterStatus, page]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleUpdateStatus = async (reportId: string) => {
    if (!updateForm.status || !updateForm.note.trim()) return;
    setUpdatingId(reportId);
    try {
      const res = await fetch(`${API_BASE}/api/v1/reports/admin/reports/${reportId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: updateForm.status, note: updateForm.note }),
      });

      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data?.message || "Failed to update status.");
        return;
      }

      setExpandedId(null);
      setUpdateForm({ status: "", note: "" });
      await fetchReports();
    } catch {
      setError("Failed to update report status.");
    } finally {
      setUpdatingId(null);
    }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <main className="min-h-screen bg-background">
      <section className="border-b-3 border-foreground bg-muted py-8">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center border-3 border-foreground bg-primary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <h1 className="font-mono text-2xl font-black">Fraud Reports</h1>
                <p className="text-sm text-muted-foreground">{total} total reports</p>
              </div>
            </div>
            <Button
              onClick={fetchReports}
              variant="outline"
              className="border-2 border-foreground font-bold"
              aria-label="Refresh reports"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      <section className="py-6">
        <div className="container mx-auto px-4">
          <div className="border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] mb-6">
            <div className="flex flex-wrap gap-4">
              <div>
                <p className="text-xs font-bold mb-2 font-mono">Type</p>
                <div className="flex flex-wrap gap-1">
                  {["", "fake_listing", "fraudulent_landlord", "rent_scam", "other"].map((t) => (
                    <button
                      key={t || "all"}
                      onClick={() => { setFilterType(t); setPage(1); }}
                      className={`border-2 border-foreground px-3 py-1 text-xs font-bold transition-all ${
                        filterType === t ? "bg-foreground text-background" : "bg-background hover:bg-muted"
                      }`}
                    >
                      {t ? TYPE_LABELS[t as ReportType] : "All"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold mb-2 font-mono">Status</p>
                <div className="flex flex-wrap gap-1">
                  {["", "new", "under_investigation", "resolved", "dismissed"].map((s) => (
                    <button
                      key={s || "all"}
                      onClick={() => { setFilterStatus(s); setPage(1); }}
                      className={`border-2 border-foreground px-3 py-1 text-xs font-bold transition-all ${
                        filterStatus === s ? "bg-foreground text-background" : "bg-background hover:bg-muted"
                      }`}
                    >
                      {s ? s.replace("_", " ") : "All"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div role="alert" className="flex items-center gap-2 border-3 border-destructive bg-red-50 p-4 mb-4">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              <p className="text-sm font-bold text-destructive">{error}</p>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : reports.length === 0 ? (
            <div className="border-3 border-foreground bg-muted p-12 text-center">
              <Shield className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <p className="font-mono font-bold">No reports found</p>
              <p className="text-muted-foreground text-sm mt-1">Adjust your filters to see more results.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((report) => (
                <Card
                  key={report.id}
                  className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="font-mono text-sm font-black">{report.referenceCode}</span>
                          <Badge className={`border text-xs font-bold ${STATUS_COLORS[report.status]}`}>
                            {report.status.replace("_", " ")}
                          </Badge>
                          <Badge variant="outline" className="border-2 border-foreground text-xs font-bold">
                            {TYPE_LABELS[report.reportType]}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">{report.description}</p>
                        {report.evidenceUrl && (
                          <a
                            href={report.evidenceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary underline mt-1 inline-block"
                          >
                            View Evidence
                          </a>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          {formatDate(report.createdAt)}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setExpandedId(expandedId === report.id ? null : report.id);
                          setUpdateForm({ status: report.status, note: "" });
                        }}
                        className="border-2 border-foreground px-3 py-2 text-xs font-bold hover:bg-muted transition-all flex items-center gap-1"
                        aria-expanded={expandedId === report.id}
                        aria-label={`Update status for ${report.referenceCode}`}
                      >
                        Update
                        <ChevronDown className={`h-3 w-3 transition-transform ${expandedId === report.id ? "rotate-180" : ""}`} />
                      </button>
                    </div>

                    {report.adminNote && (
                      <div className="mt-3 border-l-4 border-foreground pl-3">
                        <p className="text-xs font-bold">Admin Note:</p>
                        <p className="text-xs text-muted-foreground">{report.adminNote}</p>
                      </div>
                    )}

                    {expandedId === report.id && (
                      <div className="mt-4 border-t-2 border-foreground pt-4 space-y-3">
                        <div>
                          <label className="block text-xs font-bold mb-2" htmlFor={`status-${report.id}`}>
                            New Status
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {(["under_investigation", "resolved", "dismissed"] as ReportStatus[]).map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => setUpdateForm((prev) => ({ ...prev, status: s }))}
                                className={`border-2 border-foreground px-3 py-1.5 text-xs font-bold transition-all ${
                                  updateForm.status === s ? "bg-foreground text-background" : "bg-background hover:bg-muted"
                                }`}
                              >
                                {s.replace("_", " ")}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold mb-2" htmlFor={`note-${report.id}`}>
                            Note <span className="text-primary">*</span> (required)
                          </label>
                          <textarea
                            id={`note-${report.id}`}
                            value={updateForm.note}
                            onChange={(e) => setUpdateForm((prev) => ({ ...prev, note: e.target.value }))}
                            placeholder="Explain the status change..."
                            className="w-full border-2 border-foreground px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                            rows={3}
                            required
                          />
                        </div>
                        <Button
                          onClick={() => handleUpdateStatus(report.id)}
                          disabled={!updateForm.status || !updateForm.note.trim() || updatingId === report.id}
                          className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] disabled:opacity-60"
                          aria-label={`Save status update for ${report.referenceCode}`}
                        >
                          {updatingId === report.id ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                          ) : "Save Update"}
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="border-2 border-foreground font-bold"
              >
                Previous
              </Button>
              <span className="px-4 font-mono font-bold">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="border-2 border-foreground font-bold"
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
