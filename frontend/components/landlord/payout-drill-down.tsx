"use client";

import { X, AlertTriangle, Clock, CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  formatCurrency,
  DELAY_REASON_LABELS,
  DEDUCTION_TYPE_LABELS,
  PAYOUT_STATUS_LABELS,
  PAYOUT_CHANNEL_LABELS,
  type LandlordPayout,
} from "@/lib/landlordPayoutApi";
import { useState } from "react";

interface PayoutDrillDownProps {
  payout: LandlordPayout | null;
  onClose: () => void;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed": return <CheckCircle2 className="h-5 w-5 text-green-600" />;
    case "delayed": return <AlertTriangle className="h-5 w-5 text-amber-600" />;
    case "failed": return <XCircle className="h-5 w-5 text-red-600" />;
    case "on_hold": return <MinusCircle className="h-5 w-5 text-blue-600" />;
    default: return <Clock className="h-5 w-5 text-muted-foreground" />;
  }
}

export function PayoutDrillDown({ payout, onClose }: PayoutDrillDownProps) {
  const [deductionsOpen, setDeductionsOpen] = useState(true);

  if (!payout) return null;

  const statusConfig: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-800 border-blue-300",
    processing: "bg-indigo-100 text-indigo-800 border-indigo-300",
    completed: "bg-green-100 text-green-800 border-green-300",
    delayed: "bg-amber-100 text-amber-800 border-amber-300",
    failed: "bg-red-100 text-red-800 border-red-300",
    on_hold: "bg-gray-100 text-gray-800 border-gray-300",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4">
      <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StatusIcon status={payout.status} />
            <h3 className="text-lg font-bold">Payout Details</h3>
          </div>
          <Button size="sm" variant="outline" onClick={onClose} className="border-2 border-foreground font-bold">
            Close
          </Button>
        </div>

        {/* Header Info */}
        <div className="mt-4 border-3 border-foreground bg-muted p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold">{payout.propertyName}</p>
              <p className="text-sm text-muted-foreground">
                {new Date(payout.periodStart).toLocaleDateString()} — {new Date(payout.periodEnd).toLocaleDateString()}
              </p>
            </div>
            <Badge className={`text-xs font-bold ${statusConfig[payout.status] || ""}`}>
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
              <p className="text-lg font-bold text-red-600">-{formatCurrency(payout.deductions.reduce((s, d) => s + d.amount, 0), payout.currency)}</p>
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
            <p className="font-bold">{new Date(payout.scheduledDate).toLocaleDateString()}</p>
          </div>
        </div>

        {/* Delay Reasons */}
        {payout.delayReasons.length > 0 && (
          <div className="mt-4 border-3 border-amber-500/50 bg-amber-50 p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
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
          >
            <span>Deductions Breakdown ({payout.deductions.length})</span>
            {deductionsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {deductionsOpen && (
            <div className="border-2 border-t-0 border-foreground/20">
              {payout.deductions.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No deductions for this payout</p>
              ) : (
                payout.deductions.map((d, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-foreground/10 px-3 py-2 last:border-0">
                    <div>
                      <p className="text-sm font-bold">{d.label}</p>
                      <p className="text-xs text-muted-foreground">{DEDUCTION_TYPE_LABELS[d.type]}</p>
                    </div>
                    <p className="font-mono text-sm font-bold text-red-600">-{formatCurrency(d.amount, payout.currency)}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Completed Date */}
        {payout.completedDate && (
          <div className="mt-4 border-2 border-green-300 bg-green-50 p-3">
            <p className="text-xs font-bold uppercase text-green-700">Completed</p>
            <p className="font-bold text-green-800">{new Date(payout.completedDate).toLocaleString()}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
