"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  DollarSign,
  CheckCircle,
  Clock,
  Wallet,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  ListRowSkeleton,
  LoadingState,
  MoneyValue,
  StatCardSkeleton,
} from "@/components/ui/data-state";
import useAuthStore from "@/store/useAuthStore";
import { 
  getWhistleblowerEarnings, 
  getClaimableReward, 
  claimReward,
  type EarningsResponse 
} from "@/lib/api/whistleblowerApplications";
import { useCurrency } from "@/contexts/CurrencyContext";
import { formatDual, formatNgn } from "@/lib/currency";
import { formatDate } from "@/lib/date";

export default function WhistleblowerEarningsPage() {
  const { user } = useAuthStore();
  const { formatAmount } = useCurrency();
  const [earningsData, setEarningsData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimableAmount, setClaimableAmount] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const fetchEarnings = useCallback(async () => {
    if (!user?.id) {
      setError("User not authenticated");
      setLoading(false);
      return;
    }

    try {
      const data = await getWhistleblowerEarnings(user.id);
      setEarningsData(data);
      setError(null);
      
      // Fetch claimable on-chain rewards
      try {
        const claimableData = await getClaimableReward(user.id);
        setClaimableAmount(claimableData.claimableAmount);
      } catch (claimableErr) {
        // Don't fail the whole page if claimable endpoint fails
        console.warn("Failed to fetch claimable rewards:", claimableErr);
        setClaimableAmount("0");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load earnings");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchEarnings();
  }, [fetchEarnings]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchEarnings();
  }, [fetchEarnings]);

  const handleClaimReward = useCallback(async () => {
    if (!user?.id) return;
    
    setIsClaiming(true);
    setClaimError(null);
    
    try {
      const result = await claimReward(user.id);
      setClaimableAmount("0"); // Reset after successful claim
      // Refresh earnings data to show updated status
      await fetchEarnings();
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Failed to claim reward");
    } finally {
      setIsClaiming(false);
    }
  }, [user?.id, fetchEarnings]);

  // Amounts stay null until the server sends them, so an unreachable earnings
  // service dashes out rather than reporting a ₦0 balance.
  const totalEarnings = earningsData?.totals.totalNgn ?? null;
  const completedEarnings = earningsData?.totals.paidNgn ?? null;
  const pendingEarnings = earningsData?.totals.pendingNgn ?? null;

  const moneyStatus: "loading" | "error" | "ready" = loading
    ? "loading"
    : error || !earningsData
      ? "error"
      : "ready";

  /** Pairs an NGN figure with its USDC counterpart for the dual-currency display. */
  const formatPair = (usdc: number | null | undefined) => (ngn: number) =>
    typeof usdc === "number" ? formatAmount(ngn, usdc) : formatNgn(ngn);

  // Map backend status to frontend status
  const mapStatus = (status: string): "completed" | "pending" => {
    return status === "paid" ? "completed" : "pending";
  };

  return (
    <div className="min-h-screen bg-background pt-20">
      <div className="container mx-auto px-4 py-8">
        <Link
          href="/whistleblower/dashboard"
          className="inline-flex items-center gap-2 mb-8 text-sm font-bold border-b-2 border-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>

        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-black mb-2">Your Earnings</h1>
            <p className="text-muted-foreground">
              Track your income from reporting vacant apartments
            </p>
          </div>

          {/* Loading State */}
          {loading && (
            <LoadingState label="Loading your earnings" className="space-y-8">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
                {Array.from({ length: 3 }).map((_, i) => (
                  <StatCardSkeleton key={`wb-earning-stat-${i}`} />
                ))}
              </div>
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <ListRowSkeleton key={`wb-earning-row-${i}`} />
                ))}
              </div>
            </LoadingState>
          )}

          {/* Error State */}
          {!loading && error && (
            <ErrorState
              title="Failed to load earnings"
              description={error}
              onRetry={retry}
            />
          )}

          {/* Content State */}
          {!loading && !error && earningsData && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6 mb-8">
                <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-primary md:h-14 md:w-14">
                      <DollarSign className="h-6 w-6 md:h-7 md:w-7" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground md:text-sm">
                        Total Earnings
                      </p>
                      <p className="text-2xl font-black md:text-3xl">
                        <MoneyValue
                          status={moneyStatus}
                          amount={totalEarnings}
                          format={formatPair(earningsData.totals.totalUsdc)}
                          skeletonClassName="h-8 w-32"
                          unavailableLabel="Total earnings unavailable"
                        />
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        <MoneyValue
                          status={moneyStatus}
                          amount={totalEarnings}
                          format={(ngn) =>
                            typeof earningsData.totals.totalUsdc === "number"
                              ? formatDual(ngn, earningsData.totals.totalUsdc)
                              : formatNgn(ngn)
                          }
                          skeletonClassName="h-3 w-24"
                          unavailableLabel="Total earnings unavailable"
                        />
                      </p>
                    </div>
                  </div>
                </Card>

                <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-secondary md:h-14 md:w-14">
                      <CheckCircle className="h-6 w-6 md:h-7 md:w-7" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground md:text-sm">
                        Completed
                      </p>
                      <p className="text-2xl font-black md:text-3xl">
                        <MoneyValue
                          status={moneyStatus}
                          amount={completedEarnings}
                          format={formatPair(earningsData.totals.paidUsdc)}
                          skeletonClassName="h-8 w-32"
                          unavailableLabel="Completed earnings unavailable"
                        />
                      </p>
                    </div>
                  </div>
                </Card>

                <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-accent md:h-14 md:w-14">
                      <Clock className="h-6 w-6 md:h-7 md:w-7" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground md:text-sm">
                        Pending
                      </p>
                      <p className="text-2xl font-black md:text-3xl">
                        <MoneyValue
                          status={moneyStatus}
                          amount={pendingEarnings}
                          format={formatPair(earningsData.totals.pendingUsdc)}
                          skeletonClassName="h-8 w-32"
                          unavailableLabel="Pending earnings unavailable"
                        />
                      </p>
                    </div>
                  </div>
                </Card>
              </div>

              {/* On-Chain Claimable Rewards */}
              {claimableAmount && claimableAmount !== "0" && (
                <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6 mb-8 bg-gradient-to-r from-primary/10 to-accent/10">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-primary md:h-14 md:w-14">
                        <Wallet className="h-6 w-6 md:h-7 md:w-7" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground md:text-sm">
                          On-Chain Claimable
                        </p>
                        <p className="text-2xl font-black md:text-3xl text-primary">
                          {claimableAmount} USDC
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Allocated on-chain, ready to claim
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={handleClaimReward}
                      disabled={isClaiming}
                      className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                    >
                      {isClaiming ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Claiming...
                        </>
                      ) : (
                        <>
                          <Wallet className="h-4 w-4 mr-2" />
                          Claim On-Chain
                        </>
                      )}
                    </Button>
                  </div>
                  {claimError && (
                    <p className="text-sm text-destructive mt-2">{claimError}</p>
                  )}
                </Card>
              )}

              {/* Earnings List */}
              <div>
                <h2 className="font-mono text-lg font-bold mb-4 md:text-xl">
                  Earnings History
                </h2>
                {earningsData.history.length === 0 ? (
                  <EmptyState
                    icon={DollarSign}
                    title="No earnings yet"
                    description="Report a vacant apartment — you earn a reward once a tenant rents it through Shelterflex."
                    action={{
                      label: "Report an apartment",
                      href: "/whistleblower/report",
                    }}
                  />
                ) : (
                  <div className="space-y-3">
                    {earningsData.history.map((earning) => {
                      const status = mapStatus(earning.status);
                      const isOnChainAllocated = earning.onChainAllocated;
                      return (
                        <Card
                          key={earning.rewardId}
                          className={`border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6 ${isOnChainAllocated ? "bg-gradient-to-r from-primary/5 to-accent/5" : ""}`}
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div className="flex-1">
                              <p className="font-bold text-sm md:text-base">
                                Reward #{earning.rewardId.slice(0, 8)}...
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Deal: {earning.dealId.slice(0, 8)}... • Posted: {formatDate(earning.createdAt)}
                              </p>
                              {isOnChainAllocated && (
                                <p className="text-xs text-primary font-bold mt-1">
                                  ✓ Allocated on-chain
                                </p>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-4 pt-3 border-t-2 border-foreground md:border-t-0 md:border-l-2 md:pl-4">
                              <div>
                                <p className="text-lg font-black text-primary md:text-2xl">
                                  {formatAmount(earning.amountNgn, earning.amountUsdc)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDual(earning.amountNgn, earning.amountUsdc)}
                                </p>
                                {isOnChainAllocated ? (
                                  <p className="text-xs text-primary font-bold">
                                    Ready to claim on-chain
                                  </p>
                                ) : status === "pending" ? (
                                  <p className="text-xs text-muted-foreground">
                                    Pending
                                  </p>
                                ) : (
                                  <p className="text-xs text-muted-foreground">
                                    Completed {earning.paidAt ? formatDate(earning.paidAt) : ''}
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <div
                                  className={`flex items-center gap-1 px-3 py-1 border-2 border-foreground font-bold text-xs whitespace-nowrap ${
                                    isOnChainAllocated 
                                      ? "bg-primary text-background" 
                                      : status === "completed" 
                                        ? "bg-secondary" 
                                        : "bg-accent"
                                  }`}
                                >
                                  {isOnChainAllocated ? (
                                    <>
                                      <Wallet className="h-4 w-4" />
                                      Claimable
                                    </>
                                  ) : status === "completed" ? (
                                    <>
                                      <CheckCircle className="h-4 w-4" />
                                      Completed
                                    </>
                                  ) : (
                                    <>
                                      <Clock className="h-4 w-4" />
                                      Pending
                                    </>
                                  )}
                                </div>
                                {isOnChainAllocated && (
                                  <Button
                                    onClick={handleClaimReward}
                                    disabled={isClaiming}
                                    size="sm"
                                    className="border-2 border-foreground bg-primary font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)]"
                                  >
                                    {isClaiming ? (
                                      <>
                                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                        Claiming
                                      </>
                                    ) : (
                                      "Claim"
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Payment Info */}
          <Card className="border-3 border-foreground p-4 mt-8 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6 bg-muted">
            <h3 className="font-bold mb-3">How Payments Work</h3>
            <ul className="text-sm space-y-2 text-muted-foreground">
              <li>
                • Earnings are credited after the tenant's first payment
                (typically 3-5 days after rental confirmation)
              </li>
              <li>• Payments are transferred directly to your bank account</li>
              <li>• You can withdraw anytime (minimum ₦5,000)</li>
              <li>• Transaction fee: 2% of withdrawal amount</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
