"use client";

import { PaymentHistoryItem } from "@/lib/tenantApi";
import { PaymentTimelineNode } from "@/components/payment/PaymentTimelineNode";
import { Button } from "@/components/ui/button";
import type { DisputeStatus } from "@/lib/disputeTimeline";

interface PaymentTimelineProps {
  payments: PaymentHistoryItem[];
  onDownloadReceipt: (reference: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  disputeStatusByPayment?: Record<string, DisputeStatus | null>;
  onReportProblem?: (paymentId: string) => void;
  onViewDispute?: (paymentId: string) => void;
}

export function PaymentTimeline({
  payments,
  onDownloadReceipt,
  onLoadMore,
  hasMore,
  isLoading,
  disputeStatusByPayment = {},
  onReportProblem,
  onViewDispute,
}: PaymentTimelineProps) {
  // Announce the most recent payment's status to assistive tech so live updates
  // (e.g. a payment moving to "Processing"/"Paid") are conveyed without sight.
  const latest = payments[0];

  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {latest
          ? `Showing ${payments.length} payment${payments.length === 1 ? "" : "s"}. Most recent payment is ${latest.status}.`
          : ""}
      </p>

      {payments.length > 0 && (
        <ol className="space-y-6" aria-label="Payment history timeline">
          {payments.map((payment) => (
            <li key={payment.id}>
              <PaymentTimelineNode
                date={payment.transactionDate}
                amount={payment.amount}
                status={payment.status as any}
                reference={payment.reference}
                isOverdue={payment.isOverdue}
                daysOverdue={payment.daysOverdue}
                onDownloadReceipt={() => onDownloadReceipt(payment.reference)}
                confirmedOnChain={payment.confirmedOnChain}
                disputeStatus={disputeStatusByPayment[payment.id] ?? null}
                onReportProblem={
                  onReportProblem ? () => onReportProblem(payment.id) : undefined
                }
                onViewDispute={
                  onViewDispute ? () => onViewDispute(payment.id) : undefined
                }
              />
            </li>
          ))}
        </ol>
      )}

      {payments.length === 0 && (
        <div className="rounded-3xl border-2 border-dashed border-foreground/20 bg-muted p-10 text-center text-muted-foreground">
          <p className="text-lg font-bold text-foreground">No payment records yet</p>
          <p className="mt-2">Once your installments begin, each payment will be tracked here.</p>
        </div>
      )}

      {hasMore ? (
        <div className="flex justify-center">
          <Button
            onClick={onLoadMore}
            disabled={isLoading}
            className="border-2 border-foreground bg-primary font-bold shadow-[4px_4px_0_rgba(26,26,26,1)]"
          >
            {isLoading ? "Loading..." : "Load More"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
