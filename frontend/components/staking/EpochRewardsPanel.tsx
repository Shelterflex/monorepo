"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Loader2, TrendingUp, Clock, AlertCircle } from "lucide-react";
import { 
  epochGetClaimable, 
  epochClaim, 
  epochGetCurrentEpoch,
  epochGetEpoch,
  type EpochClaimableResponse,
  type EpochClaimResponse,
  type CurrentEpochResponse,
  type EpochInfo
} from "@/lib/api/epochRewards";

export function EpochRewardsPanel() {
  const [claimable, setClaimable] = useState<string | null>(null);
  const [currentEpoch, setCurrentEpoch] = useState<number | null>(null);
  const [epochInfo, setEpochInfo] = useState<EpochInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEpochData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch current epoch
      const currentEpochRes = await epochGetCurrentEpoch();
      setCurrentEpoch(currentEpochRes.currentEpoch);

      // Fetch claimable amount
      const claimableRes = await epochGetClaimable();
      setClaimable(claimableRes.claimable);

      // Fetch epoch info for the current epoch
      if (currentEpochRes.currentEpoch) {
        try {
          const epochInfoRes = await epochGetEpoch(currentEpochRes.currentEpoch);
          setEpochInfo(epochInfoRes.data);
        } catch (epochErr) {
          // Epoch info might not be available yet, that's ok
          console.warn("Failed to fetch epoch info:", epochErr);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load epoch rewards data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEpochData();
  }, [fetchEpochData]);

  const handleClaim = useCallback(async () => {
    setIsClaiming(true);
    setError(null);
    
    try {
      const result = await epochClaim();
      setClaimable("0");
      await fetchEpochData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to claim rewards");
    } finally {
      setIsClaiming(false);
    }
  }, [fetchEpochData]);

  // Check if epoch is sealed
  const isEpochSealed = epochInfo?.sealed ?? false;
  
  // Format timestamp to readable date
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Calculate time until seal
  const getTimeUntilSeal = () => {
    if (!epochInfo) return null;
    const now = Math.floor(Date.now() / 1000);
    const secondsUntilSeal = epochInfo.seal_ts - now;
    if (secondsUntilSeal <= 0) return null;
    
    const days = Math.floor(secondsUntilSeal / (24 * 60 * 60));
    const hours = Math.floor((secondsUntilSeal % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((secondsUntilSeal % (60 * 60)) / 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const timeUntilSeal = getTimeUntilSeal();

  return (
    <Card className="border-2 border-foreground/10 bg-card shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-primary/5 via-transparent to-transparent pb-4 border-b border-foreground/5">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <CardTitle className="text-base font-bold text-foreground">Epoch Rewards</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Epoch-based staking rewards with periodic distribution
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3.5 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : (
          <>
            {/* Current Epoch Info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-foreground/10 bg-muted/20 p-3">
                <div className="text-[10px] font-bold uppercase text-muted-foreground">Current Epoch</div>
                <div className="mt-1 font-mono text-sm font-black">
                  {currentEpoch ?? "N/A"}
                </div>
              </div>
              <div className="rounded-lg border border-foreground/10 bg-muted/20 p-3">
                <div className="text-[10px] font-bold uppercase text-muted-foreground">Status</div>
                <div className="mt-1 font-mono text-sm font-black">
                  {isEpochSealed ? (
                    <span className="text-emerald-600 dark:text-emerald-500">Sealed</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-500">Active</span>
                  )}
                </div>
              </div>
            </div>

            {/* Claimable Amount */}
            <div className="rounded-xl border border-foreground/5 bg-muted/30 p-3.5 flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Claimable Rewards</span>
              <span className="font-mono text-sm font-black text-primary">
                {claimable ?? "0.000000"} USDC
              </span>
            </div>

            {/* Epoch Status Message */}
            {!isEpochSealed && timeUntilSeal && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-xs text-amber-600 dark:text-amber-500">
                <Clock className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold">Epoch in progress</span>
                  <p className="text-[10px] text-muted-foreground">
                    Rewards available after epoch seals in {timeUntilSeal}
                  </p>
                </div>
              </div>
            )}

            {isEpochSealed && (!claimable || claimable === "0") && (
              <div className="flex items-start gap-2 rounded-xl border border-muted-foreground/20 bg-muted/5 p-3.5 text-xs text-muted-foreground">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold">No rewards available</span>
                  <p className="text-[10px]">
                    Epoch is sealed but you have no claimable rewards. Stake more to earn rewards in the next epoch.
                  </p>
                </div>
              </div>
            )}

            {/* Claim Button */}
            <Button
              onClick={handleClaim}
              disabled={isClaiming || !claimable || claimable === "0"}
              className="w-full h-10 border-2 border-primary bg-primary text-primary-foreground text-xs font-bold rounded-xl shadow-sm hover:shadow transition-all disabled:opacity-50"
            >
              {isClaiming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Claiming...
                </>
              ) : (
                <>
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Claim {claimable || "0"} USDC
                </>
              )}
            </Button>

            {/* Epoch Details (when available) */}
            {epochInfo && (
              <div className="pt-2 border-t border-foreground/5">
                <p className="text-[10px] text-muted-foreground font-medium mb-2">Epoch Details</p>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-muted-foreground">Start:</span>
                    <span className="ml-1 font-mono">{formatTimestamp(epochInfo.start_ts)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">End:</span>
                    <span className="ml-1 font-mono">{formatTimestamp(epochInfo.end_ts)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Seal:</span>
                    <span className="ml-1 font-mono">{formatTimestamp(epochInfo.seal_ts)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="ml-1 font-mono">{Math.floor(epochInfo.duration_secs / 3600)}h</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
