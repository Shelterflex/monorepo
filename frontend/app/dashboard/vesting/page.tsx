"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Wallet,
  Clock,
  CheckCircle,
  TrendingUp,
  Calendar,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MoneyValue,
} from "@/components/ui/data-state";
import useAuthStore from "@/store/useAuthStore";
import { 
  getVestingSchedule, 
  getClaimableVested, 
  claimVested,
  type VestingSchedule 
} from "@/lib/api/vestingSchedule";

export default function VestingPage() {
  const { user } = useAuthStore();
  const [vestingSchedule, setVestingSchedule] = useState<VestingSchedule | null>(null);
  const [claimableAmount, setClaimableAmount] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const fetchVestingData = useCallback(async () => {
    if (!user?.id) {
      setError("User not authenticated");
      setLoading(false);
      return;
    }

    try {
      const schedule = await getVestingSchedule(user.id);
      setVestingSchedule(schedule);
      setError(null);
      
      // Fetch claimable amount
      try {
        const claimable = await getClaimableVested(user.id);
        setClaimableAmount(claimable.claimableAmount);
      } catch (claimableErr) {
        console.warn("Failed to fetch claimable amount:", claimableErr);
        setClaimableAmount("0");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vesting schedule");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchVestingData();
  }, [fetchVestingData]);

  const handleClaim = useCallback(async () => {
    if (!user?.id) return;
    
    setIsClaiming(true);
    setClaimError(null);
    
    try {
      await claimVested(user.id);
      setClaimableAmount("0");
      await fetchVestingData();
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Failed to claim vested tokens");
    } finally {
      setIsClaiming(false);
    }
  }, [user?.id, fetchVestingData]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchVestingData();
  }, [fetchVestingData]);

  // Calculate vesting progress
  const calculateProgress = () => {
    if (!vestingSchedule) return 0;
    const total = BigInt(vestingSchedule.totalAmount);
    const vested = BigInt(vestingSchedule.vestedAmount);
    if (total === BigInt(0)) return 0;
    return Number((vested * BigInt(100)) / total);
  };

  // Check if we're pre-cliff
  const isPreCliff = () => {
    if (!vestingSchedule) return false;
    const now = Math.floor(Date.now() / 1000);
    return now < vestingSchedule.cliffTime;
  };

  // Format timestamp to readable date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Format timestamp to readable date with time
  const formatDateTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const progress = calculateProgress();
  const preCliff = isPreCliff();

  return (
    <div className="min-h-screen bg-background pt-20">
      <div className="container mx-auto px-4 py-8">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 mb-8 text-sm font-bold border-b-2 border-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>

        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-black mb-2">Vesting Schedule</h1>
            <p className="text-muted-foreground">
              Track your token vesting progress and claim available funds
            </p>
          </div>

          {/* Loading State */}
          {loading && (
            <LoadingState label="Loading vesting schedule" />
          )}

          {/* Error State */}
          {!loading && error && (
            <ErrorState
              title="Failed to load vesting schedule"
              description={error}
              onRetry={retry}
            />
          )}

          {/* Content State */}
          {!loading && !error && vestingSchedule && (
            <>
              {/* Stats Cards */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6 mb-8">
                <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-primary md:h-14 md:w-14">
                      <Wallet className="h-6 w-6 md:h-7 md:w-7" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground md:text-sm">
                        Total Allocation
                      </p>
                      <p className="text-2xl font-black md:text-3xl">
                        {vestingSchedule.totalAmount} USDC
                      </p>
                    </div>
                  </div>
                </Card>

                <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-secondary md:h-14 md:w-14">
                      <TrendingUp className="h-6 w-6 md:h-7 md:w-7" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground md:text-sm">
                        Vested So Far
                      </p>
                      <p className="text-2xl font-black md:text-3xl">
                        {vestingSchedule.vestedAmount} USDC
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {progress}% vested
                      </p>
                    </div>
                  </div>
                </Card>

                <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-accent md:h-14 md:w-14">
                      <CheckCircle className="h-6 w-6 md:h-7 md:w-7" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground md:text-sm">
                        Claimable Now
                      </p>
                      <p className="text-2xl font-black md:text-3xl">
                        {claimableAmount || "0"} USDC
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {preCliff ? "Pre-cliff" : "Available"}
                      </p>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Claim Action Card */}
              <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6 mb-8 bg-gradient-to-r from-primary/10 to-accent/10">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="font-bold text-lg mb-1">Claim Vested Tokens</h3>
                    <p className="text-sm text-muted-foreground">
                      {preCliff 
                        ? `Tokens will be claimable after ${formatDateTime(vestingSchedule.cliffTime)}`
                        : `You have ${claimableAmount || "0"} USDC available to claim`
                      }
                    </p>
                  </div>
                  <Button
                    onClick={handleClaim}
                    disabled={isClaiming || preCliff || !claimableAmount || claimableAmount === "0"}
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
                        Claim {claimableAmount || "0"} USDC
                      </>
                    )}
                  </Button>
                </div>
                {claimError && (
                  <p className="text-sm text-destructive mt-2">{claimError}</p>
                )}
              </Card>

              {/* Timeline Card */}
              <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6 mb-8">
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Vesting Timeline
                </h3>
                
                {/* Progress Bar */}
                <div className="mb-6">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-bold">{progress}%</span>
                  </div>
                  <div className="h-4 border-2 border-foreground bg-muted relative overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* Timeline Events */}
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className={`flex h-8 w-8 items-center justify-center border-2 border-foreground ${
                      Date.now() / 1000 >= vestingSchedule.startTime 
                        ? "bg-secondary" 
                        : "bg-muted"
                    }`}>
                      <Clock className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold">Start Date</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDateTime(vestingSchedule.startTime)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className={`flex h-8 w-8 items-center justify-center border-2 border-foreground ${
                      Date.now() / 1000 >= vestingSchedule.cliffTime 
                        ? "bg-secondary" 
                        : "bg-accent"
                    }`}>
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold">Cliff Date</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDateTime(vestingSchedule.cliffTime)}
                      </p>
                      {preCliff && (
                        <p className="text-xs text-accent font-bold mt-1">
                          Unlock date - no tokens claimable before this
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className={`flex h-8 w-8 items-center justify-center border-2 border-foreground ${
                      Date.now() / 1000 >= vestingSchedule.endTime 
                        ? "bg-secondary" 
                        : "bg-muted"
                    }`}>
                      <CheckCircle className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold">End Date</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDateTime(vestingSchedule.endTime)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Full vesting completion
                      </p>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Schedule Details */}
              <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                <h3 className="font-bold text-lg mb-4">Schedule Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Beneficiary</p>
                    <p className="font-mono text-xs">{vestingSchedule.beneficiary.slice(0, 8)}...{vestingSchedule.beneficiary.slice(-4)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Total Amount</p>
                    <p className="font-bold">{vestingSchedule.totalAmount} USDC</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Claimed Amount</p>
                    <p className="font-bold">{vestingSchedule.claimedAmount} USDC</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Revocable</p>
                    <p className="font-bold">{vestingSchedule.revocable ? "Yes" : "No"}</p>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
