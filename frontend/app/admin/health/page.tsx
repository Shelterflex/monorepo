"use client";

/**
 * Admin Platform Health Dashboard  (#684)
 *
 * Live panels: service uptime, job queue depth, active worker count, error rate.
 * Historical alert feed with severity, timestamp, and resolution status.
 * Auto-refreshes every 15 s; all panels handle degraded / offline states.
 */

import { useState, useEffect, useCallback, startTransition } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Server,
  Loader2,
  XCircle,
  Layers,
  Zap,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import BackendHealthCompact from "@/components/BackendHealthCompact";
import JobHealthPanel from "@/components/admin/JobHealthPanel";
import { apiGet } from "@/lib/apiClient";

// ── Types ─────────────────────────────────────────────────────────────────────

type ServiceStatus = "healthy" | "degraded" | "offline";

interface ServicePanel {
  name: string;
  status: ServiceStatus;
  uptimeSeconds: number;
  version?: string;
}

interface QueuePanel {
  name: string;
  depth: number;
  workers: number;
}

interface ErrorRatePanel {
  window: string; // e.g. "last 5 min"
  rate: number;   // errors per minute
  total: number;
}

interface HealthSnapshot {
  capturedAt: string;
  services: ServicePanel[];
  queues: QueuePanel[];
  errorRate: ErrorRatePanel;
}

type AlertSeverity = "critical" | "high" | "medium" | "low";
type AlertStatus = "open" | "resolved";

interface Alert {
  id: string;
  severity: AlertSeverity;
  message: string;
  occurredAt: string;
  resolvedAt?: string;
  status: AlertStatus;
}

interface AlertPage {
  data: Alert[];
  hasNextPage: boolean;
  nextCursor: string | null;
}

interface IndexedReceipt {
  txId: string;
  txType: string;
  dealId: string;
  amountUsdc: string;
  indexedAt: string;
}

interface ReceiptsPage {
  data: IndexedReceipt[];
  total: number;
  page: number;
  pageSize: number;
}

type PanelState<T> =
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "ok"; data: T };

// ── Mock fetch helpers (replace with real apiFetch calls) ─────────────────────

async function fetchHealthSnapshot(): Promise<HealthSnapshot> {
  const res = await fetch(`/api/admin/health-snapshot`);
  if (!res.ok) throw new Error(`Health snapshot failed: ${res.status}`);
  return res.json();
}

async function fetchAlerts(params: {
  severity?: AlertSeverity;
  status?: AlertStatus;
  cursor?: string;
  limit?: number;
}): Promise<AlertPage> {
  const q = new URLSearchParams();
  if (params.severity) q.set("severity", params.severity);
  if (params.status)   q.set("status",   params.status);
  if (params.cursor)   q.set("cursor",   params.cursor);
  q.set("limit", String(params.limit ?? 20));
  const res = await fetch(`/api/admin/alerts?${q}`);
  if (!res.ok) throw new Error(`Alerts failed: ${res.status}`);
  return res.json();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ServiceStatus }) {
  const cls =
    status === "healthy"
      ? "bg-green-500"
      : status === "degraded"
      ? "bg-yellow-400"
      : "bg-red-500";
  return (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls} flex-shrink-0`} />
  );
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  const variant =
    status === "healthy" ? "default" : status === "degraded" ? "secondary" : "destructive";
  return <Badge variant={variant}>{status}</Badge>;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function ServicePanelCard({ panel }: { panel: ServicePanel }) {
  return (
    <Card
      className={`border-2 ${
        panel.status === "healthy"
          ? "border-green-200"
          : panel.status === "degraded"
          ? "border-yellow-300"
          : "border-red-400"
      }`}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <StatusDot status={panel.status} />
          {panel.name}
          <span className="ml-auto">
            <StatusBadge status={panel.status} />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm text-muted-foreground">
        <div className="flex justify-between">
          <span>Uptime</span>
          <span className="font-medium text-foreground">{formatUptime(panel.uptimeSeconds)}</span>
        </div>
        {panel.version && (
          <div className="flex justify-between">
            <span>Version</span>
            <span className="font-mono text-xs">{panel.version}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const cls =
    severity === "critical"
      ? "bg-red-100 text-red-700 border-red-300"
      : severity === "high"
      ? "bg-orange-100 text-orange-700 border-orange-300"
      : severity === "medium"
      ? "bg-yellow-100 text-yellow-700 border-yellow-300"
      : "bg-blue-100 text-blue-700 border-blue-300";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${cls} uppercase`}>
      {severity}
    </span>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      {alert.status === "resolved" ? (
        <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground leading-snug">{alert.message}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatDateTime(alert.occurredAt)}
          {alert.resolvedAt && (
            <span className="ml-2 text-green-600">
              · resolved {formatDateTime(alert.resolvedAt)}
            </span>
          )}
        </p>
      </div>
      <SeverityBadge severity={alert.severity} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 15_000;
const ALERT_SEVERITY_OPTIONS: Array<AlertSeverity | "all"> = ["all", "critical", "high", "medium", "low"];
const ALERT_STATUS_OPTIONS: Array<AlertStatus | "all"> = ["all", "open", "resolved"];

export default function AdminHealthPage() {
  const [snapshot, setSnapshot] = useState<PanelState<HealthSnapshot>>({ type: "loading" });
  const [alerts, setAlerts]     = useState<PanelState<AlertPage>>({ type: "loading" });
  const [receipts, setReceipts] = useState<PanelState<ReceiptsPage>>({ type: "loading" });
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | "all">("all");
  const [statusFilter, setStatusFilter]     = useState<AlertStatus | "all">("open");
  const [lastRefreshed, setLastRefreshed]   = useState<Date | null>(null);

  const loadSnapshot = useCallback(async () => {
    try {
      const data = await fetchHealthSnapshot();
      setSnapshot({ type: "ok", data });
    } catch (err) {
      setSnapshot({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
    }
    setLastRefreshed(new Date());
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const data = await fetchAlerts({
        severity: severityFilter === "all" ? undefined : severityFilter,
        status:   statusFilter   === "all" ? undefined : statusFilter,
      });
      setAlerts({ type: "ok", data });
    } catch (err) {
      setAlerts({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
    }
  }, [severityFilter, statusFilter]);

  const loadReceipts = useCallback(async () => {
    try {
      const data = await apiGet<ReceiptsPage>("/admin/receipts?page=1&pageSize=10");
      setReceipts({ type: "ok", data });
    } catch (err) {
      setReceipts({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
    }
  }, []);

  // Initial load + auto-refresh (startTransition prevents cascading-render lint error)
  useEffect(() => {
    startTransition(() => { void loadSnapshot(); });
    startTransition(() => { void loadAlerts(); });
    startTransition(() => { void loadReceipts(); });
    const id = setInterval(
      () => startTransition(() => { void loadSnapshot(); }),
      REFRESH_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [loadSnapshot, loadAlerts, loadReceipts]);

  // Reload alerts when filters change (loadAlerts dep already includes filter values via closure)
  useEffect(() => {
    startTransition(() => { void loadAlerts(); });
  }, [severityFilter, statusFilter, loadAlerts]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Platform Health</h1>
          <p className="text-sm text-muted-foreground">
            Live metrics · auto-refreshes every {REFRESH_INTERVAL_MS / 1000}s
            {lastRefreshed && (
              <span className="ml-2">· last updated {lastRefreshed.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BackendHealthCompact />
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void loadSnapshot(); void loadAlerts(); }}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Service uptime panels */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Server className="h-4 w-4" /> Services
        </h2>
        {snapshot.type === "loading" && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
          </div>
        )}
        {snapshot.type === "error" && (
          <Card className="border-red-300 bg-red-50">
            <CardContent className="flex items-center gap-2 py-4 text-red-700 text-sm">
              <XCircle className="h-4 w-4" /> {snapshot.message}
            </CardContent>
          </Card>
        )}
        {snapshot.type === "ok" && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {snapshot.data.services.map((s) => (
              <ServicePanelCard key={s.name} panel={s} />
            ))}
          </div>
        )}
      </section>

      {/* Background job health — surfaces jobs that have stopped running at all */}
      <JobHealthPanel />

      {/* Queue depth + error rate */}
      {snapshot.type === "ok" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Job queues */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers className="h-4 w-4" /> Job Queues
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {snapshot.data.queues.map((q) => (
                <div key={q.name} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{q.name}</span>
                  <div className="flex items-center gap-4">
                    <span>
                      <span className="font-semibold text-foreground">{q.depth}</span>
                      <span className="text-muted-foreground ml-1">queued</span>
                    </span>
                    <span>
                      <span className="font-semibold text-foreground">{q.workers}</span>
                      <span className="text-muted-foreground ml-1">workers</span>
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Error rate */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-4 w-4" /> Error Rate
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Window</span>
                <span className="font-medium">{snapshot.data.errorRate.window}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rate</span>
                <span className={`font-bold ${snapshot.data.errorRate.rate > 1 ? "text-red-600" : "text-green-600"}`}>
                  {snapshot.data.errorRate.rate.toFixed(2)} / min
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total errors</span>
                <span className="font-medium">{snapshot.data.errorRate.total}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Alert history */}
      <section>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Activity className="h-4 w-4" /> Alert History
          </h2>
          {/* Severity filter */}
          <div className="flex gap-1 flex-wrap">
            {ALERT_SEVERITY_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSeverityFilter(s)}
                className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                  severityFilter === s
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:border-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {/* Status filter */}
          <div className="flex gap-1 flex-wrap">
            {ALERT_STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                  statusFilter === s
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:border-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <Card>
          <CardContent className="pt-4">
            {alerts.type === "loading" && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded" />)}
              </div>
            )}
            {alerts.type === "error" && (
              <div className="flex items-center gap-2 text-red-600 text-sm py-4">
                <XCircle className="h-4 w-4" /> {alerts.message}
              </div>
            )}
            {alerts.type === "ok" && alerts.data.data.length === 0 && (
              <div className="flex flex-col items-center py-10 text-muted-foreground gap-2">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
                <p className="text-sm">No alerts match the selected filters.</p>
              </div>
            )}
            {alerts.type === "ok" && alerts.data.data.length > 0 && (
              <>
                {alerts.data.data.map((a) => <AlertRow key={a.id} alert={a} />)}
                {alerts.data.hasNextPage && (
                  <div className="pt-3 text-center">
                    <Button variant="ghost" size="sm" className="text-muted-foreground text-xs">
                      Load more
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Receipts section */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <FileText className="h-4 w-4" /> Recent Receipts
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadReceipts()}
            className="text-muted-foreground text-xs hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <Card>
          <CardContent className="pt-4">
            {receipts.type === "loading" && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded" />)}
              </div>
            )}
            {receipts.type === "error" && (
              <div className="flex items-center gap-2 text-red-600 text-sm py-4">
                <XCircle className="h-4 w-4" /> {receipts.message}
              </div>
            )}
            {receipts.type === "ok" && receipts.data.data.length === 0 && (
              <div className="flex flex-col items-center py-10 text-muted-foreground gap-2">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
                <p className="text-sm">No receipts indexed yet.</p>
              </div>
            )}
            {receipts.type === "ok" && receipts.data.data.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead className="border-b-2 border-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-bold">TX ID</th>
                      <th className="text-left px-3 py-2 text-xs font-bold">Type</th>
                      <th className="text-left px-3 py-2 text-xs font-bold">Deal</th>
                      <th className="text-right px-3 py-2 text-xs font-bold">Amount</th>
                      <th className="text-left px-3 py-2 text-xs font-bold">Indexed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.data.data.map((r) => (
                      <tr key={r.txId} className="border-b border-foreground/10 hover:bg-muted/50">
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.txId.slice(0, 10)}...</td>
                        <td className="px-3 py-2">
                          <span className="px-2 py-1 bg-accent text-xs font-bold rounded">
                            {r.txType}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.dealId.slice(0, 10)}...</td>
                        <td className="text-right px-3 py-2 font-semibold">${r.amountUsdc}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {new Date(r.indexedAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="pt-3 text-center text-xs text-muted-foreground">
                  Showing {receipts.data.data.length} of {receipts.data.total} total
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
