"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Home,
  CreditCard,
  FileText,
  Settings,
  MessageSquare,
  Building2,
  Menu,
  X,
  Search,
  Eye,
  Clock,
  AlertTriangle,
  XCircle,
  File,
  Tag,
  Filter,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DashboardHeader } from "@/components/dashboard-header";
import { DocumentPreviewDialog } from "@/components/tenant/document-preview-dialog";
import {
  listDocuments,
  previewDocument,
  deleteDocument,
  getExpirationInfo,
  formatFileSize,
  isPreviewable,
  CATEGORY_LABELS,
  STATUS_LABELS,
  type TenantDocument,
  type DocumentCategory,
  type DocumentStatus,
  type DocumentPreview,
} from "@/lib/documentVaultApi";

const CATEGORIES: DocumentCategory[] = [
  "identification",
  "receipt",
  "agreement",
  "insurance",
  "utility",
  "other",
];

const STATUSES: DocumentStatus[] = [
  "active",
  "expired",
  "expiring_soon",
  "pending_review",
  "rejected",
];

function StatusBadge({ status }: { status: DocumentStatus }) {
  const config: Record<
    DocumentStatus,
    { variant: "default" | "secondary" | "destructive" | "outline"; className: string }
  > = {
    active: {
      variant: "default",
      className: "bg-green-100 text-green-800 border-green-300",
    },
    expired: {
      variant: "destructive",
      className: "bg-red-100 text-red-800 border-red-300",
    },
    expiring_soon: {
      variant: "secondary",
      className: "bg-amber-100 text-amber-800 border-amber-300",
    },
    pending_review: {
      variant: "outline",
      className: "bg-blue-100 text-blue-800 border-blue-300",
    },
    rejected: {
      variant: "destructive",
      className: "bg-red-50 text-red-700 border-red-200",
    },
  };
  const c = config[status];
  return (
    <Badge variant={c.variant} className={`text-xs font-bold ${c.className}`}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function ExpirationIndicator({ expiresAt }: { expiresAt: string | null }) {
  const { label, isExpired, isExpiringSoon } = getExpirationInfo(expiresAt);
  if (!expiresAt) return null;
  return (
    <div
      className={`flex items-center gap-1 text-xs font-bold ${
        isExpired
          ? "text-red-600"
          : isExpiringSoon
            ? "text-amber-600"
            : "text-muted-foreground"
      }`}
    >
      {isExpired ? (
        <XCircle className="h-3.5 w-3.5" />
      ) : isExpiringSoon ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : (
        <Clock className="h-3.5 w-3.5" />
      )}
      {label}
    </div>
  );
}

function CategoryIcon({ category }: { category: DocumentCategory }) {
  const iconMap: Record<DocumentCategory, React.ReactNode> = {
    identification: <ShieldCheck className="h-4 w-4" />,
    receipt: <FileText className="h-4 w-4" />,
    agreement: <File className="h-4 w-4" />,
    insurance: <ShieldCheck className="h-4 w-4" />,
    utility: <File className="h-4 w-4" />,
    other: <File className="h-4 w-4" />,
  };
  return <>{iconMap[category]}</>;
}

export default function DocumentVaultPage() {
  const [documents, setDocuments] = useState<TenantDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<DocumentCategory | "">("");
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | "">("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [previewDoc, setPreviewDoc] = useState<DocumentPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listDocuments({
        search: search || undefined,
        category: categoryFilter || undefined,
        status: statusFilter || undefined,
        page,
        pageSize: 12,
      });
      setDocuments(result.data);
      setTotalPages(result.pagination.totalPages);
      setTotal(result.pagination.total);
    } catch (err: any) {
      setError(err?.message || "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter, statusFilter, page]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, statusFilter]);

  const handlePreview = async (doc: TenantDocument) => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewDoc(null);
    try {
      const result = await previewDocument(doc.id);
      setPreviewDoc(result.data);
    } catch (err: any) {
      setPreviewError(err?.message || "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm("Are you sure you want to delete this document?")) return;
    try {
      await deleteDocument(docId);
      fetchDocuments();
    } catch {
      // UI will show stale data
    }
  };

  const expiringSoonCount = documents.filter(
    (d) => d.status === "expiring_soon" || d.status === "expired",
  ).length;

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center border-3 border-foreground bg-primary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] lg:hidden"
      >
        {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-foreground/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-40 h-screen w-64 border-r-3 border-foreground bg-card pt-20 transition-transform lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-full flex-col px-4 py-6">
          <div className="mb-8 border-3 border-foreground bg-secondary p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <p className="text-sm font-medium text-foreground">Logged in as</p>
            <p className="text-lg font-bold text-foreground">Ngozi Adekunle</p>
            <p className="text-sm text-muted-foreground">Tenant</p>
          </div>
          <nav className="flex-1 space-y-2">
            <Link href="/dashboard/tenant" className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" onClick={() => setSidebarOpen(false)}>
              <Home className="h-5 w-5" />Dashboard
            </Link>
            <Link href="/dashboard/tenant/payments" className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" onClick={() => setSidebarOpen(false)}>
              <CreditCard className="h-5 w-5" />Payments
            </Link>
            <Link href="/dashboard/tenant/lease" className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" onClick={() => setSidebarOpen(false)}>
              <FileText className="h-5 w-5" />My Lease
            </Link>
            <Link href="/dashboard/tenant/vault" className="flex items-center gap-3 border-3 border-foreground bg-primary p-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" onClick={() => setSidebarOpen(false)}>
              <ShieldCheck className="h-5 w-5" />Document Vault
            </Link>
            <Link href="/properties" className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" onClick={() => setSidebarOpen(false)}>
              <Building2 className="h-5 w-5" />Browse Properties
            </Link>
            <Link href="/messages" className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" onClick={() => setSidebarOpen(false)}>
              <MessageSquare className="h-5 w-5" />Messages
            </Link>
            <Link href="/dashboard/tenant/settings" className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" onClick={() => setSidebarOpen(false)}>
              <Settings className="h-5 w-5" />Settings
            </Link>
          </nav>
        </div>
      </aside>

      <main className="min-h-screen pt-20 lg:ml-64">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="mb-6 md:mb-8">
            <h1 className="text-2xl font-bold text-foreground md:text-3xl lg:text-4xl">
              Document Vault
            </h1>
            <p className="mt-2 text-sm text-muted-foreground md:text-base">
              Track and manage your important documents, IDs, receipts, and agreements
            </p>
          </div>

          {expiringSoonCount > 0 && (
            <div className="mb-6 flex items-center gap-3 border-3 border-amber-500 bg-amber-50 p-4 shadow-[4px_4px_0px_0px_rgba(217,119,6,0.3)]">
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
              <div>
                <p className="font-bold text-amber-800">
                  {expiringSoonCount} document{expiringSoonCount > 1 ? "s" : ""} need attention
                </p>
                <p className="text-sm text-amber-700">
                  Some documents are expiring soon or have already expired. Review them below.
                </p>
              </div>
            </div>
          )}

          <Card className="mb-6 border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-sm font-bold">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search by name, description, or tag..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full border-3 border-foreground bg-background py-2 pl-10 pr-4 font-mono text-sm shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:outline-none focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  />
                </div>
              </div>
              <div className="w-full md:w-48">
                <label className="mb-1 block text-sm font-bold">
                  <Filter className="mr-1 inline h-3.5 w-3.5" />Category
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as DocumentCategory | "")}
                  className="w-full border-3 border-foreground bg-background px-3 py-2 text-sm shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:outline-none"
                >
                  <option value="">All Categories</option>
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                  ))}
                </select>
              </div>
              <div className="w-full md:w-48">
                <label className="mb-1 block text-sm font-bold">
                  <Filter className="mr-1 inline h-3.5 w-3.5" />Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as DocumentStatus | "")}
                  className="w-full border-3 border-foreground bg-background px-3 py-2 text-sm shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:outline-none"
                >
                  <option value="">All Statuses</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              {(search || categoryFilter || statusFilter) && (
                <Button variant="outline" onClick={() => { setSearch(""); setCategoryFilter(""); setStatusFilter(""); }} className="border-2 border-foreground font-bold">
                  <X className="mr-1 h-4 w-4" />Clear
                </Button>
              )}
            </div>
          </Card>

          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {total} document{total !== 1 ? "s" : ""} found
            </p>
          </div>

          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="animate-pulse border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <div className="h-4 w-3/4 bg-muted" />
                  <div className="mt-3 h-3 w-1/2 bg-muted" />
                  <div className="mt-3 h-3 w-1/3 bg-muted" />
                </Card>
              ))}
            </div>
          ) : error ? (
            <Card className="border-3 border-destructive p-6 text-center">
              <XCircle className="mx-auto h-12 w-12 text-destructive" />
              <p className="mt-4 font-bold text-destructive">{error}</p>
              <Button onClick={fetchDocuments} className="mt-4 border-2 border-foreground font-bold">Retry</Button>
            </Card>
          ) : documents.length === 0 ? (
            <Card className="border-3 border-foreground p-8 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <File className="mx-auto h-16 w-16 text-muted-foreground" />
              <p className="mt-4 text-lg font-bold">No documents found</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {search || categoryFilter || statusFilter
                  ? "Try adjusting your search or filters"
                  : "Upload your first document to get started"}
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {documents.map((doc) => (
                <Card
                  key={doc.id}
                  className={`border-3 p-0 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${
                    doc.status === "expired"
                      ? "border-red-400"
                      : doc.status === "expiring_soon"
                        ? "border-amber-400"
                        : "border-foreground"
                  }`}
                >
                  <div
                    className={`flex items-center justify-between border-b-2 p-4 ${
                      doc.status === "expired"
                        ? "border-red-200 bg-red-50"
                        : doc.status === "expiring_soon"
                          ? "border-amber-200 bg-amber-50"
                          : "border-foreground/10 bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <CategoryIcon category={doc.category} />
                      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        {CATEGORY_LABELS[doc.category]}
                      </span>
                    </div>
                    <StatusBadge status={doc.status} />
                  </div>
                  <div className="p-4">
                    <h4 className="truncate font-bold">{doc.fileName}</h4>
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="uppercase font-mono">.{doc.fileFormat}</span>
                      <span>{formatFileSize(doc.fileSizeBytes)}</span>
                    </div>
                    {doc.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{doc.description}</p>
                    )}
                    {doc.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {doc.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="inline-flex items-center gap-1 border border-foreground/20 bg-muted px-2 py-0.5 text-xs font-medium">
                            <Tag className="h-2.5 w-2.5" />{tag}
                          </span>
                        ))}
                        {doc.tags.length > 4 && (
                          <span className="text-xs text-muted-foreground">+{doc.tags.length - 4} more</span>
                        )}
                      </div>
                    )}
                    <div className="mt-3">
                      <ExpirationIndicator expiresAt={doc.expiresAt} />
                    </div>
                    <div className="mt-4 flex items-center gap-2 border-t-2 border-foreground/10 pt-3">
                      <Button size="sm" onClick={() => handlePreview(doc)} disabled={previewLoading} className="border-2 border-foreground bg-primary font-bold text-xs">
                        <Eye className="mr-1 h-3.5 w-3.5" />Preview
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleDelete(doc.id)} className="ml-auto border-2 border-destructive/50 font-bold text-xs text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="border-2 border-foreground font-bold">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-3 text-sm font-bold">Page {page} of {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="border-2 border-foreground font-bold">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </main>

      {(previewDoc || previewLoading || previewError) && (
        <DocumentPreviewDialog
          preview={previewDoc}
          loading={previewLoading}
          error={previewError}
          onClose={() => { setPreviewDoc(null); setPreviewError(null); }}
        />
      )}
    </div>
  );
}
