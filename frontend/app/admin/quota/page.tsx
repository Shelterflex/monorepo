"use client";

import { useState } from "react";
import { Gauge, Search, Loader2, RotateCcw, PlusCircle, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  fetchQuotaUsage,
  fetchQuotaOverrides,
  createQuotaOverride,
  removeQuotaOverride,
  resetQuota,
  type QuotaUsage,
  type QuotaOverride,
} from "@/lib/quotaAdminApi";
import { handleError, showSuccessToast } from "@/lib/toast";

export default function AdminQuotaPage() {
  const [lookupUserId, setLookupUserId] = useState("");
  const [lookupEndpoint, setLookupEndpoint] = useState("");

  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [usage, setUsage] = useState<QuotaUsage | null>(null);
  const [overrides, setOverrides] = useState<QuotaOverride[]>([]);
  const [loading, setLoading] = useState(false);

  const [overrideForm, setOverrideForm] = useState({
    endpoint: "",
    elevatedLimit: "",
    reason: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadUser = async (userId: string) => {
    if (!userId.trim()) return;
    setLoading(true);
    try {
      const [usageRes, overridesRes] = await Promise.all([
        fetchQuotaUsage(userId, lookupEndpoint || undefined),
        fetchQuotaOverrides(userId),
      ]);
      setUsage(usageRes);
      setOverrides(overridesRes);
      setActiveUserId(userId);
    } catch (err) {
      handleError(err, "Failed to load quota state for this user");
      setUsage(null);
      setOverrides([]);
      setActiveUserId(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    loadUser(lookupUserId);
  };

  const handleCreateOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUserId) return;
    const elevatedLimit = Number(overrideForm.elevatedLimit);
    if (!Number.isFinite(elevatedLimit) || elevatedLimit <= 0 || !overrideForm.reason.trim()) {
      handleError(new Error("Provide a positive limit and a reason"), "Invalid override");
      return;
    }

    setSubmitting(true);
    try {
      await createQuotaOverride({
        userId: activeUserId,
        endpoint: overrideForm.endpoint || undefined,
        elevatedLimit,
        reason: overrideForm.reason,
      });
      showSuccessToast("Quota override created");
      setOverrideForm({ endpoint: "", elevatedLimit: "", reason: "" });
      await loadUser(activeUserId);
    } catch (err) {
      handleError(err, "Failed to create quota override");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveOverride = async (endpoint?: string) => {
    if (!activeUserId) return;
    try {
      await removeQuotaOverride(activeUserId, endpoint);
      showSuccessToast("Quota override removed");
      await loadUser(activeUserId);
    } catch (err) {
      handleError(err, "Failed to remove quota override");
    }
  };

  const handleReset = async () => {
    if (!activeUserId) return;
    setResetting(true);
    try {
      await resetQuota(activeUserId, lookupEndpoint || undefined);
      showSuccessToast("Quota reset");
      await loadUser(activeUserId);
    } catch (err) {
      handleError(err, "Failed to reset quota");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-4 border-foreground bg-card p-6 md:p-10">
        <div className="container mx-auto space-y-2">
          <div className="flex items-center gap-3">
            <Gauge className="w-8 h-8 md:w-10 md:h-10 text-primary" />
            <h1 className="text-3xl md:text-5xl font-black tracking-tighter uppercase italic">
              Quota <span className="text-primary">Management</span>
            </h1>
          </div>
          <p className="text-lg font-bold text-muted-foreground max-w-2xl">
            Look up a user's rate/usage quota state and adjust it — grant a temporary elevated
            limit, remove an override, or reset counters during a live incident.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 md:py-16 space-y-10">
        <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <form onSubmit={handleLookup} className="flex flex-col md:flex-row gap-4 md:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="lookup-user-id" className="font-bold uppercase text-xs">User ID</Label>
              <Input
                id="lookup-user-id"
                value={lookupUserId}
                onChange={(e) => setLookupUserId(e.target.value)}
                placeholder="user-uuid"
                required
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="lookup-endpoint" className="font-bold uppercase text-xs">Endpoint (optional)</Label>
              <Input
                id="lookup-endpoint"
                value={lookupEndpoint}
                onChange={(e) => setLookupEndpoint(e.target.value)}
                placeholder="e.g. /api/v1/withdrawals"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="font-bold border-2 border-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
            >
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Look Up
            </Button>
          </form>
        </Card>

        {activeUserId && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-black uppercase">Current Usage</h2>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleReset}
                  disabled={resetting}
                  className="font-bold border-2 border-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  {resetting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-1" />}
                  Reset
                </Button>
              </div>

              {usage ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 border-2 border-foreground bg-muted/50">
                    <p className="text-xs uppercase font-bold text-muted-foreground">Per-minute</p>
                    <p className="font-black text-lg">{usage.minuteUsage} / {usage.minuteLimit}</p>
                  </div>
                  <div className="p-3 border-2 border-foreground bg-muted/50">
                    <p className="text-xs uppercase font-bold text-muted-foreground">Per-day</p>
                    <p className="font-black text-lg">{usage.dayUsage} / {usage.dayLimit}</p>
                  </div>
                  {usage.nearLimit && (
                    <div className="col-span-2 flex items-center gap-2 text-destructive font-bold text-xs">
                      <AlertCircle className="w-4 h-4" />
                      This user is near their quota limit
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No usage data available.</p>
              )}
            </Card>

            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] space-y-4">
              <h2 className="text-xl font-black uppercase">Active Overrides</h2>
              {overrides.length === 0 ? (
                <p className="text-sm text-muted-foreground">No overrides configured for this user.</p>
              ) : (
                <ul className="space-y-2">
                  {overrides.map((o) => (
                    <li
                      key={`${o.userId}:${o.endpoint ?? "all"}`}
                      className="flex items-center justify-between gap-3 p-3 border-2 border-foreground bg-muted/30"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Badge className="border-2 border-foreground font-bold">{o.endpoint ?? "all endpoints"}</Badge>
                          <span className="font-mono text-xs font-bold">limit: {o.elevatedLimit}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{o.reason}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveOverride(o.endpoint)}
                        className="text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <form onSubmit={handleCreateOverride} className="pt-4 border-t-2 border-foreground/20 space-y-3">
                <h3 className="text-sm font-black uppercase">New Override</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="override-endpoint" className="text-xs font-bold uppercase">Endpoint</Label>
                    <Input
                      id="override-endpoint"
                      value={overrideForm.endpoint}
                      onChange={(e) => setOverrideForm((f) => ({ ...f, endpoint: e.target.value }))}
                      placeholder="all endpoints"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="override-limit" className="text-xs font-bold uppercase">Elevated Limit</Label>
                    <Input
                      id="override-limit"
                      type="number"
                      min={1}
                      max={10000}
                      value={overrideForm.elevatedLimit}
                      onChange={(e) => setOverrideForm((f) => ({ ...f, elevatedLimit: e.target.value }))}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="override-reason" className="text-xs font-bold uppercase">Reason</Label>
                  <Input
                    id="override-reason"
                    value={overrideForm.reason}
                    onChange={(e) => setOverrideForm((f) => ({ ...f, reason: e.target.value }))}
                    placeholder="Why is this user getting an elevated limit?"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full font-bold border-2 border-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlusCircle className="w-4 h-4 mr-2" />}
                  Create Override
                </Button>
              </form>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
