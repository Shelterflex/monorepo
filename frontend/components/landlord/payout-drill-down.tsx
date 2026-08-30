"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  X, AlertTriangle, Clock, CheckCircle2, XCircle, MinusCircle,
  ChevronDown, ChevronUp, Loader2, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import {
  getPayoutDetail,
  formatCurrency, formatPayoutDate, formatPayoutDateTime,
  DELAY_REASON_LABELS, DEDUCTION_TYPE_LABELS,
  PAYOUT_STATUS_LABELS, PAYOUT_CHANNEL_LABELS,
  type LandlordPayout,
} from "@/lib/landlordPayoutApi";

interface PayoutDrillDownProps {
  payoutId: string;
  onClose: () => void;
}

function StatusIcon({ status, className = "" }: { status: string; className?: string }) {
  const srLabel = PAYOUT_STATUS_LABELS[status as keyof typeof PAYOUT_STATUS_LABELS] ?? status;
  switch (status) {
    case "completed":
      return <CheckCircle2 className={`h-5 w-5 text-green-600 ${className}`} aria-hidden="true" />;
    case "delayed":
      return <AlertTriangle className={`h-5 w-5 text-amber-600 ${className}`} aria-hidden="true" />;
    case "failed":
      return <XCircle className={`h-5 w-5 text-red-600 ${className}`} aria-hidden="true" />;
    case "on_hold":
      return <MinusCircle className={`h-5 w-5 text-blue-600 ${className}`} aria-hidden="true" />;
    default:
      return <Clock className={`h-5 w-5 text-muted-foreground ${className}`} aria-hidden="true" />;
  }
}

const STATUS_CLASSES: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 border-blue-300",
  processing: "bg-indigo-100 text-indigo-800 border-indigo-300",
  completed: "bg-green-100 text-green-800 border-green-300",
  delayed: "bg-amber-100 text-amber-800 border-amber-300",
  failed: "bg-red-100 text-red-800 border-red-300",
  on_hold: "bg-gray-100 text-gray-800 border-gray-300",
};

export function PayoutDrillDown({ payoutId, onClose }: PayoutDrillDownProps) {
  const [payout, setPayout] = useState<LandlordPayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deductionsOpen, setDeductionsOpen] = useState(true);
  const dialogRef = useFocusTrap(true, onClose);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPayoutDetail(payoutId);
      setPayout(result.data);
    } catch (err: any) {
      setError(err?.message || "Failed to load payout details");
    } finally {
      setLoading(false);
    }
  }, [payoutId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Payout details"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <Card
        ref={dialogRef}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!loading && payout && <StatusIcon status={payout.status} />}
            <h3 className="text-lg font-bold">Payout Details</h3>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            className="border-2 border-foreground font-bold"
            aria-label="Close payout details"
          >
            Close
          </Button>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="mt-6 space-y-4" role="status" aria-label="Loading payout details">
            <p className="sr-only">Loading payout details...</p>
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="animate-pulse space-y-3">
              <div className="h-5 w-48 bg-muted rounded" />
              <div className="h-4 w-32 bg-muted rounded" />
              <div className="grid grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-3 w-16 bg-muted rounded mx-auto" />
                    <div className="h-6 w-24 bg-muted rounded mx-auto" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="mt-6 text-center" role="alert">
            <XCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
            <p className="mt-3 font-bold text-destructive">{error}</p>
            <Button
              onClick={fetchDetail}
              className="mt-3 border-2 border-foreground font-bold"
              aria-label="Retry loading payout details"
            >
              <RotateCcw className="mr-1 h-4 w-4" />Retry
            </Button>
          </div>
        )}

        {/* Payout content */}
        {payout && !loading && !error && (
          <>
            {/* Header Info */}
            <div className="mt-4 border-3 border-foreground bg-muted p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold">{payout.propertyName}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatPayoutDate(payout.periodStart)} &mdash; {formatPayoutDate(payout.periodEnd)}
                  </p>
                </div>
                <Badge
                  className={`text-xs font-bold ${STATUS_CLASSES[payout.status] || ""}`}
                  aria-label={`Status: ${PAYOUT_STATUS_LABELS[payout.status]}`}
                >
                  <StatusIcon status={payout.status} className="mr-1 h-3 w-3" />
                  {PAYOUT_STATUS_LABELS[payout.status]}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs font-bold uppercase text-muted-foreground">Gross</p>
                  <p className="text-lg font-bold">{formatCurrency(payout.grossAmount, payout.currency)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-muted-foreground">Deductions</p>
                  <p className="text-lg font-bold text-red-600">
                    -{formatCurrency(payout.deductions.reduce((s, d) => s + d.amount, 0), payout.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-muted-foreground">Net</p>
                  <p className="text-lg font-bold text-green-700">{formatCurrency(payout.netAmount, payout.currency)}</p>
                </div>
              </div>
            </div>

            {/* Channel & Dates */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="border-2 border-foreground/20 p-3">
                <p className="text-xs font-bold uppercase text-muted-foreground">Payout Channel</p>
                <p className="font-bold">{PAYOUT_CHANNEL_LABELS[payout.channel]}</p>
              </div>
              <div className="border-2 border-foreground/20 p-3">
                <p className="text-xs font-bold uppercase text-muted-foreground">Scheduled Date</p>
                <p className="font-bold">{formatPayoutDate(payout.scheduledDate)}</p>
              </div>
            </div>

            {/* Delay Reasons */}
            {payout.delayReasons.length > 0 && (
              <div className="mt-4 border-3 border-amber-500/50 bg-amber-50 p-4" role="region" aria-label="Delay reasons">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
                  <p className="font-bold text-amber-800">Delay Reasons</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {payout.delayReasons.map((reason) => (
                    <Badge key={reason} className="border-amber-300 bg-amber-100 text-xs font-bold text-amber-800">
                      {DELAY_REASON_LABELS[reason as keyof typeof DELAY_REASON_LABELS] || reason}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Deductions Breakdown */}
            <div className="mt-4">
              <button
                onClick={() => setDeductionsOpen(!deductionsOpen)}
                className="flex w-full items-center justify-between border-2 border-foreground/20 p-3 text-left font-bold"
                aria-expanded={deductionsOpen}
                aria-controls="deductions-list"
              >
                <span>Deductions Breakdown ({payout.deductions.length})</span>
                {deductionsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {deductionsOpen && (
                <div id="deductions-list" className="border-2 border-t-0 border-foreground/20">
                  {payout.deductions.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">No deductions for this payout</p>
                  ) : (
                    <table className="w-full text-sm" aria-label="Deductions breakdown">
                      <thead className="sr-only">
                        <tr>
                          <th className="text-left px-3 py-2">Description</th>
                          <th className="text-right px-3 py-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payout.deductions.map((d, i) => (
                          <tr key={i} className="border-b border-foreground/10 last:border-0">
                            <td className="px-3 py-2">
                              <p className="font-bold">{d.label}</p>
                              <p className="text-xs text-muted-foreground">{DEDUCTION_TYPE_LABELS[d.type]}</p>
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-red-600">
                              -{formatCurrency(d.amount, payout.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>

            {/* Completed Date */}
            {payout.completedDate && (
              <div className="mt-4 border-2 border-green-300 bg-green-50 p-3">
                <p className="text-xs font-bold uppercase text-green-700">Completed</p>
                <p className="font-bold text-green-800">{formatPayoutDateTime(payout.completedDate)}</p>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
