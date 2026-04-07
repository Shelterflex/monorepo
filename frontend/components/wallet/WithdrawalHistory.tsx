"use client";

import { useState, useCallback, useEffect } from "react";
import { RefreshCw, AlertCircle, ExternalLink, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

import {
  getWithdrawalHistory,
  type WithdrawalResponse,
} from "@/lib/walletApi";

type LoadState<T> =
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "success"; data: T };

function formatNgn(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount);
}

function withdrawalStatusPresentation(status: WithdrawalResponse["status"]) {
  switch (status) {
    case "pending":
      return { label: "Pending", variant: "outline" as const };
    case "approved":
      return { label: "Approved", variant: "default" as const };
    case "rejected":
      return { label: "Rejected", variant: "destructive" as const };
    case "confirmed":
      return { label: "Confirmed", variant: "secondary" as const };
    case "failed":
      return { label: "Failed", variant: "destructive" as const };
    default:
      return { label: "Unknown", variant: "outline" as const };
  }
}

interface WithdrawalHistoryProps {
  className?: string;
}

export function WithdrawalHistory({ className }: Readonly<WithdrawalHistoryProps>) {
  const [withdrawalState, setWithdrawalState] = useState<LoadState<WithdrawalResponse[]>>({
    type: "loading",
  });

  const fetchWithdrawalHistory = useCallback(async () => {
    setWithdrawalState({ type: "loading" });
    try {
      const response = await getWithdrawalHistory({ limit: 10 });
      setWithdrawalState({ type: "success", data: response.entries });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setWithdrawalState({ type: "error", message });
    }
  }, []);

  // Initial fetch using useEffect (not useState initializer)
  useEffect(() => {
    fetchWithdrawalHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold md:text-xl">Withdrawal History</h2>
        <Button
          variant="outline"
          size="sm"
          className="border-2 border-foreground bg-background font-bold"
          onClick={fetchWithdrawalHistory}
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>

      <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <CardContent className="pt-6">
          {withdrawalState.type === "loading" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4 border-b border-foreground/10 pb-3">
                <div className="flex min-w-0 flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-20" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-foreground/10 pb-3">
                <div className="flex min-w-0 flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-20" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-20" />
                </div>
              </div>
            </div>
          )}

          {withdrawalState.type === "error" && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-destructive/10">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <p className="font-bold">Could not load withdrawal history</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {withdrawalState.message}
                </p>
              </div>
              <Button
                className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                onClick={fetchWithdrawalHistory}
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
            </div>
          )}

          {withdrawalState.type === "success" && withdrawalState.data.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-muted">
                <Wallet className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-bold">No withdrawals yet</p>
              <p className="text-sm text-muted-foreground">
                Your withdrawal requests will show up here.
              </p>
            </div>
          )}

          {withdrawalState.type === "success" && withdrawalState.data.length > 0 && (
            <div className="divide-y divide-foreground/10">
              {withdrawalState.data.map((withdrawal: WithdrawalResponse) => {
                const { label, variant } = withdrawalStatusPresentation(withdrawal.status);

                return (
                  <div
                    key={withdrawal.id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-bold">Withdrawal</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {new Date(withdrawal.createdAt).toLocaleString("en-NG")}
                        </span>
                        <span className="truncate border border-foreground/20 bg-muted px-2 py-0.5 font-mono">
                          {withdrawal.reference}
                        </span>
                        <span>{withdrawal.bankAccount.bankName}</span>
                        <span className="font-mono">{withdrawal.bankAccount.accountNumber}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
                      <p className="font-mono text-base font-black text-destructive">
                        -{formatNgn(withdrawal.amountNgn)}
                      </p>
                      <div className="flex flex-col items-end gap-2">
                        <Badge variant={variant}>{label}</Badge>
                        {(withdrawal.status === "failed" || withdrawal.status === "rejected") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              // Open support contact - could be a mailto link or support page
                              globalThis.location.href = "mailto:support@example.com?subject=Withdrawal Issue - " + withdrawal.reference;
                            }}
                          >
                            <ExternalLink className="mr-1 h-3 w-3" />
                            Contact support
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
