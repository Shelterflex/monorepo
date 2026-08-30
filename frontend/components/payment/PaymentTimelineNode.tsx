"use client";

import {
  ArrowRight,
  Download,
  CircleDot,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Link2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNgn } from "@/lib/currency";
import type { DisputeStatus } from "@/lib/disputeTimeline";

type PaymentStatus = "Paid" | "Overdue" | "Upcoming" | "Processing";

const disputeConfig: Record<DisputeStatus, { className: string; icon: LucideIcon }> = {
  pending: { className: "bg-amber-100 text-amber-900 border-amber-300", icon: ShieldAlert },
  under_review: { className: "bg-amber-100 text-amber-900 border-amber-300", icon: ShieldAlert },
  resolved: { className: "bg-emerald-100 text-emerald-900 border-emerald-300", icon: ShieldCheck },
  rejected: { className: "bg-red-100 text-red-900 border-red-300", icon: ShieldAlert },
};

export interface PaymentTimelineNodeProps {
  date: string;
  amount: number;
  status: PaymentStatus;
  reference: string;
  isOverdue?: boolean;
  daysOverdue?: number;
  onDownloadReceipt?: () => void;
  disputeStatus?: DisputeStatus | null;
  onReportProblem?: () => void;
  onViewDispute?: () => void;
  /**
   * True once this payment's rent-to-own equity is confirmed on-chain
   * (record_equity_payment landed). False/undefined shows nothing extra —
   * this is an additive indicator, not a replacement for `status`.
   */
  confirmedOnChain?: boolean;
}

// Each status pairs a label with a distinct icon so it is never conveyed by
// colour alone (WCAG 1.4.1). Colours chosen to meet AA contrast on the badge.
const statusConfig: Record<PaymentStatus, { className: string; icon: LucideIcon; spin?: boolean }> = {
  Paid: { className: "bg-emerald-100 text-emerald-900 border-emerald-300", icon: CheckCircle2 },
  Overdue: { className: "bg-red-100 text-red-900 border-red-300", icon: AlertTriangle },
  Upcoming: { className: "bg-primary/10 text-primary border-primary/30", icon: Clock },
  Processing: { className: "bg-amber-100 text-amber-900 border-amber-300", icon: Loader2, spin: true },
};

export function PaymentTimelineNode({
  date,
  amount,
  status,
  reference,
  isOverdue = false,
  daysOverdue,
  onDownloadReceipt,
  disputeStatus = null,
  onReportProblem,
  onViewDispute,
  confirmedOnChain,
}: PaymentTimelineNodeProps) {
  const { className: statusClassName, icon: StatusIcon, spin } = statusConfig[status];
  const dispute = disputeStatus ? disputeConfig[disputeStatus] : null;
  return (
    <div className="group relative flex gap-4 rounded-3xl border-2 border-foreground/10 bg-card p-5 shadow-[4px_4px_0_rgba(26,26,26,0.1)] transition hover:-translate-y-0.5 hover:shadow-[6px_6px_0_rgba(26,26,26,0.1)]">
      <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full border-2 border-foreground/20 bg-muted text-foreground">
        <CircleDot className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="flex-1 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">{date}</p>
            <p className="mt-1 text-xl font-bold">{formatNgn(amount)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${statusClassName}`}
            >
              <StatusIcon
                className={`h-3.5 w-3.5 ${spin ? "motion-safe:animate-spin" : ""}`}
                aria-hidden="true"
              />
              <span className="sr-only">Status: </span>
              {status}
            </span>
            {confirmedOnChain ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-900"
                title="Equity for this payment is recorded on-chain"
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                Confirmed on-chain
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>Reference: {reference}</span>
          {isOverdue && daysOverdue ? (
            <span className="rounded-full bg-red-50 px-2 py-1 text-red-700">
              {daysOverdue} day{daysOverdue === 1 ? "" : "s"} overdue
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onDownloadReceipt}
            className="border-2 border-foreground bg-background text-foreground hover:bg-muted"
          >
            <Download className="mr-2 h-4 w-4" />
            Download Receipt
          </Button>
          {disputeStatus && dispute ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onViewDispute}
              className="border-2 border-foreground bg-background text-foreground hover:bg-muted"
            >
              <dispute.icon className="mr-2 h-4 w-4" />
              View Dispute
            </Button>
          ) : onReportProblem ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onReportProblem}
              className="border-2 border-foreground bg-background text-foreground hover:bg-muted"
            >
              <ShieldAlert className="mr-2 h-4 w-4" />
              Report a problem
            </Button>
          ) : null}
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowRight className="h-3 w-3" />
            View payment details
          </span>
        </div>
      </div>
    </div>
  );
}
