"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStakingHistory, type StakingHistoryItem } from "@/lib/config";
import { Loader2, AlertCircle, History, ArrowUpRight, ArrowDownLeft, Gift, ExternalLink, RefreshCw } from "lucide-react";
import { formatUsdc } from "./PositionCard";
import {
  ErrorState,
  ListRowSkeleton,
  LoadingState,
} from "@/components/ui/data-state";
import { formatDateTime } from "@/lib/date";

interface HistoryTableProps {
  walletAddress?: string | null;
}

export function HistoryTable({ walletAddress }: HistoryTableProps) {
  const [history, setHistory] = useState<StakingHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getStakingHistory(walletAddress);
      if (res.success) {
        setHistory(res.history);
      } else {
        setError("Failed to fetch staking history");
      }
    } catch (err) {
      console.error("Failed to load staking history:", err);
      setError("Failed to connect and retrieve staking history");
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const getTxTypeDetails = (type: string) => {
    switch (type) {
      case "STAKE":
        return {
          label: "Staked",
          color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
          icon: <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />,
        };
      case "UNSTAKE":
        return {
          label: "Unstaked",
          color: "bg-amber-500/10 text-amber-600 dark:text-amber-500 border-amber-500/20",
          icon: <ArrowDownLeft className="h-3.5 w-3.5 text-amber-500" />,
        };
      case "STAKE_REWARD_CLAIM":
        return {
          label: "Claimed Rewards",
          color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
          icon: <Gift className="h-3.5 w-3.5 text-blue-500" />,
        };
      default:
        return {
          label: type,
          color: "bg-muted text-muted-foreground border-muted-foreground/10",
          icon: <History className="h-3.5 w-3.5 text-muted-foreground" />,
        };
    }
  };

  const formatNgn = (amount?: string | number) => {
    if (!amount) return "";
    const num = typeof amount === "string" ? parseFloat(amount) : amount;
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(num);
  };

  return (
    <Card className="border-2 border-foreground/10 bg-card shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 border-b border-foreground/5">
        <div>
          <CardTitle className="text-lg font-black text-foreground flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Staking History
          </CardTitle>
          <CardDescription>
            Your lifetime audit log of staking, unstaking, and claimed reward transactions
          </CardDescription>
        </div>
        <button
          type="button"
          onClick={fetchHistory}
          disabled={isLoading}
          className="p-2 text-muted-foreground hover:text-foreground rounded-lg border border-foreground/10 hover:bg-muted transition-all disabled:opacity-50"
          title="Refresh History"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <LoadingState label="Loading staking history" className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <ListRowSkeleton key={i} />
            ))}
          </LoadingState>
        ) : error ? (
          <ErrorState
            className="m-4"
            title="Staking history is unavailable"
            description={error}
            onRetry={fetchHistory}
            retryLabel="Reload ledger"
          />
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4 space-y-4">
            <div className="rounded-full bg-muted p-4 border border-foreground/5">
              <History className="h-10 w-10 text-muted-foreground/60" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">No history yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm mt-1">
                Your future smart contract activities (stakes, unstakes, reward claims) will appear here.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Staking transaction history">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Date & Time</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Action</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">USDC Volume</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Conversion details</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Transaction Hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((item) => {
                  const details = getTxTypeDetails(item.txType);
                  return (
                    <TableRow key={item.txId} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-medium text-sm text-foreground">
                        {formatDateTime(item.indexedAt)}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${details.color}`}>
                          {details.icon}
                          {details.label}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-sm font-black text-foreground">
                        {formatUsdc(item.amountUsdc)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.amountNgn ? (
                          <div className="space-y-0.5">
                            <span className="font-bold text-foreground/80">{formatNgn(item.amountNgn)}</span>
                            {item.fxRate && (
                              <p className="text-[10px] text-muted-foreground font-mono">
                                Rate: ₦{Number(item.fxRate).toLocaleString()} / USDC
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <a
                          href={`https://stellar.expert/explorer/public/tx/${item.txId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-mono"
                          title="View on Stellar.Expert Explorer"
                        >
                          {item.txId.slice(0, 6)}...{item.txId.slice(-6)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
