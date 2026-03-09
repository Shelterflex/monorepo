"use client";

import React, { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, Clock, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { apiPost } from "@/lib/api";

export type TransactionStatus = "pending" | "queued" | "confirmed" | "failed";

export interface TransactionStatusPanelProps {
  status: TransactionStatus;
  txId?: string | null;
  outboxId?: string | null;
  message?: string | null;
  allowRetry?: boolean;
  onRetry?: () => void;
  className?: string;
}

interface RetryResponse {
  success: boolean;
  item?: {
    id: string;
    status: string;
    txId?: string;
  };
  message: string;
}

export function TransactionStatusPanel({
  status,
  txId,
  outboxId,
  message,
  allowRetry = false,
  onRetry,
  className = "",
}: TransactionStatusPanelProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<TransactionStatus>(status);

  const handleRetry = async () => {
    if (!outboxId || (!allowRetry && !onRetry)) return;

    setIsRetrying(true);
    setRetryError(null);

    try {
      if (onRetry) {
        // Use custom retry handler if provided
        await onRetry();
      } else if (outboxId) {
        // Use admin retry endpoint
        const response = await apiPost<RetryResponse>(`/api/admin/outbox/${outboxId}/retry`, {});
        
        if (response.success) {
          // Update status based on response
          const newStatus = response.item?.status?.toLowerCase();
          if (newStatus === "confirmed" || newStatus === "completed") {
            setCurrentStatus("confirmed");
          } else if (newStatus === "pending" || newStatus === "queued") {
            setCurrentStatus("queued");
          }
        } else {
          setRetryError(response.message || "Retry failed");
        }
      }
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setIsRetrying(false);
    }
  };

  const getStatusConfig = (status: TransactionStatus) => {
    switch (status) {
      case "pending":
        return {
          icon: Clock,
          title: "Processing",
          description: message || "Transaction is being processed...",
          variant: "default" as const,
          iconClass: "text-blue-500",
          bgClass: "bg-blue-50",
          borderClass: "border-blue-200",
        };
      case "queued":
        return {
          icon: Loader2,
          title: "Queued for Retry",
          description: message || "Transaction is queued and will be retried automatically",
          variant: "default" as const,
          iconClass: "text-amber-500 animate-spin",
          bgClass: "bg-amber-50",
          borderClass: "border-amber-200",
        };
      case "confirmed":
        return {
          icon: CheckCircle2,
          title: "Confirmed",
          description: message || "Transaction has been confirmed successfully",
          variant: "default" as const,
          iconClass: "text-green-500",
          bgClass: "bg-green-50",
          borderClass: "border-green-200",
        };
      case "failed":
        return {
          icon: XCircle,
          title: "Failed",
          description: message || "Transaction failed. You can retry or contact support.",
          variant: "destructive" as const,
          iconClass: "text-destructive",
          bgClass: "bg-destructive/10",
          borderClass: "border-destructive/20",
        };
      default:
        return {
          icon: Clock,
          title: "Processing",
          description: message || "Transaction is being processed...",
          variant: "default" as const,
          iconClass: "text-blue-500",
          bgClass: "bg-blue-50",
          borderClass: "border-blue-200",
        };
    }
  };

  const config = getStatusConfig(currentStatus);
  const StatusIcon = config.icon;
  const showRetry = currentStatus === "failed" && (allowRetry || onRetry || outboxId);

  return (
    <Card className={`border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${className}`}>
      <CardHeader className={`${config.bgClass} border-b ${config.borderClass}`}>
        <div className="flex items-center gap-3">
          <StatusIcon className={`h-6 w-6 ${config.iconClass}`} />
          <div>
            <CardTitle className="font-mono text-lg">{config.title}</CardTitle>
            {txId && (
              <CardDescription className="font-mono text-xs mt-1">
                Tx: {txId.slice(0, 16)}...{txId.slice(-8)}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <p className="text-sm text-muted-foreground">{config.description}</p>

        {(txId || outboxId) && (
          <div className="space-y-2 text-xs font-mono text-muted-foreground">
            {txId && (
              <div className="flex justify-between">
                <span>Transaction ID:</span>
                <span className="truncate max-w-[200px]">{txId}</span>
              </div>
            )}
            {outboxId && (
              <div className="flex justify-between">
                <span>Outbox ID:</span>
                <span className="truncate max-w-[200px]">{outboxId}</span>
              </div>
            )}
          </div>
        )}

        {retryError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{retryError}</span>
          </div>
        )}

        {showRetry && (
          <Button
            onClick={handleRetry}
            disabled={isRetrying}
            variant="outline"
            className="w-full border-2 border-foreground font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)]"
          >
            {isRetrying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Retrying...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry Transaction
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default TransactionStatusPanel;
