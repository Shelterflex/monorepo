"use client";

import { CheckCircle2, CircleDot, XCircle } from "lucide-react";
import {
  buildStatusTimeline,
  DISPUTE_REASON_LABELS,
  type TimelineStepState,
} from "@/lib/disputeTimeline";
import type { PaymentDispute } from "@/lib/tenantApi";
import { formatDate, formatDateTime } from "@/lib/date";

const stateIcon: Record<TimelineStepState, typeof CircleDot> = {
  complete: CheckCircle2,
  current: CircleDot,
  upcoming: CircleDot,
};

export function DisputeStatusTimeline({ dispute }: { dispute: PaymentDispute }) {
  const steps = buildStatusTimeline(dispute.status);
  const terminal = dispute.status === "rejected" ? "Rejected" : "Resolved";
  const timelineLabel =
    dispute.status === "pending" || dispute.status === "under_review"
      ? "Under Review"
      : terminal;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border-2 border-foreground/20 bg-muted p-4">
        <div>
          <p className="text-sm font-bold">{DISPUTE_REASON_LABELS[dispute.reason]}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Filed {formatDate(dispute.createdAt)}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
            dispute.status === "rejected"
              ? "bg-red-100 text-red-900 border-red-300"
              : dispute.status === "resolved"
                ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                : "bg-amber-100 text-amber-900 border-amber-300"
          }`}
        >
          {timelineLabel}
        </span>
      </div>

      <ol className="space-y-0" aria-label="Dispute status timeline">
        {steps.map((step, index) => {
          const Icon = stateIcon[step.state];
          return (
            <li key={step.status} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 ${
                    step.state === "complete"
                      ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                      : step.state === "current"
                        ? "border-foreground bg-foreground text-background"
                        : "border-foreground/20 bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                {index < steps.length - 1 ? (
                  <div className="h-full w-0.5 flex-none bg-foreground/10" aria-hidden="true" />
                ) : null}
              </div>
              <div className="pb-6">
                <p
                  className={`text-sm font-bold ${
                    step.state === "upcoming" ? "text-muted-foreground" : "text-foreground"
                  }`}
                >
                  {step.label}
                </p>
                {step.timestamp ? (
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(step.timestamp)}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {dispute.resolution ? (
        <div className="rounded-3xl border-2 border-foreground/20 bg-muted p-4">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Resolution
          </p>
          <p className="mt-1 text-sm">{dispute.resolution}</p>
        </div>
      ) : null}
    </div>
  );
}