"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Wallet, Coins, AlertCircle, Info, Calculator, Check, ArrowRight, DollarSign } from "lucide-react";
import { ACCOUNT_FROZEN_MESSAGE } from "@/lib/api";
import { NgnStakingFlow } from "./ngn-flow/NgnStakingFlow";
import type { Quote } from "@/lib/ngnStakingApi";
import type { NgnBalanceResponse } from "@/lib/walletApi";
import { formatUsdc } from "./PositionCard";

interface StakeFormProps {
  isFrozen: boolean;
  isLoadingBalance: boolean;
  isStaking: boolean;
  ngnBalance: NgnBalanceResponse | null;
  stakeAmount: string;
  setStakeAmount: (val: string) => void;
  handleStake: () => Promise<void>;
  stakingMode: "ngn_deposit" | "ngn_balance" | "usdc";
  setStakingMode: (mode: "ngn_deposit" | "ngn_balance" | "usdc") => void;
  status: string;
  setStatus: (status: string) => void;
  
  // NGN Deposit flow props
  ngnDepositAmount: string;
  setNgnDepositAmount: (val: string) => void;
  ngnQuote: Quote | null;
  setNgnQuote: (quote: Quote | null) => void;
  isLoadingQuote: boolean;
  setIsLoadingQuote: (val: boolean) => void;
  quoteError: string | null;
  setQuoteError: (err: string | null) => void;
  showNgnFlow: boolean;
  setShowNgnFlow: (val: boolean) => void;
  handleGetQuote: () => Promise<void>;
  handleNgnFlowComplete: (pos: any) => void;
  handleNgnFlowCancel: () => void;
}

interface LockPeriod {
  days: number;
  label: string;
  apy: number;
}

const LOCK_PERIODS: LockPeriod[] = [
  { days: 30, label: "30 Days (Flex)", apy: 12.5 },
  { days: 90, label: "90 Days", apy: 15.0 },
  { days: 180, label: "180 Days", apy: 18.5 },
  { days: 365, label: "365 Days", apy: 24.0 },
];

export function StakeForm({
  isFrozen,
  isLoadingBalance,
  isStaking,
  ngnBalance,
  stakeAmount,
  setStakeAmount,
  handleStake,
  stakingMode,
  setStakingMode,
  status,
  setStatus,
  ngnDepositAmount,
  setNgnDepositAmount,
  ngnQuote,
  setNgnQuote,
  isLoadingQuote,
  setIsLoadingQuote,
  quoteError,
  setQuoteError,
  showNgnFlow,
  setShowNgnFlow,
  handleGetQuote,
  handleNgnFlowComplete,
  handleNgnFlowCancel,
}: StakeFormProps) {
  const [selectedLock, setSelectedLock] = useState<LockPeriod>(LOCK_PERIODS[2]); // Default 180 Days

  const handleLockSelect = (lock: LockPeriod) => {
    setSelectedLock(lock);
  };

  const formatNgn = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  // Calculate estimated returns
  const getEstimatedReturns = () => {
    let amountUsdc = 0;
    if (stakingMode === "usdc") {
      amountUsdc = Number(stakeAmount) || 0;
    } else if (stakingMode === "ngn_balance") {
      // Estimated at 1 NGN = 0.00067 USDC (1500 NGN/USDC approximate)
      amountUsdc = (Number(stakeAmount) || 0) / 1500;
    } else if (stakingMode === "ngn_deposit") {
      amountUsdc = (Number(ngnDepositAmount) || 0) / 1500;
    }

    if (amountUsdc <= 0) return null;

    const interest = amountUsdc * (selectedLock.apy / 100) * (selectedLock.days / 365);
    return {
      principal: amountUsdc,
      interest: interest,
      total: amountUsdc + interest,
    };
  };

  const estimate = getEstimatedReturns();

  let ngnBalanceTabContent: React.ReactNode;
  if (isFrozen) {
    ngnBalanceTabContent = (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-center sm:text-left">
        <p className="font-semibold text-destructive">{ACCOUNT_FROZEN_MESSAGE}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Please top up your NGN wallet to repay the negative balance before attempting to stake.
        </p>
      </div>
    );
  } else if (isLoadingBalance) {
    ngnBalanceTabContent = (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  } else if (ngnBalance) {
    ngnBalanceTabContent = (
      <div className="space-y-5">
        <div className="rounded-xl border border-foreground/10 bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Available NGN Balance</span>
            <span className="font-mono text-base font-black text-foreground">{formatNgn(ngnBalance.availableNgn)}</span>
          </div>
          {ngnBalance.heldNgn > 0 && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-foreground/5">
              <span className="text-sm text-muted-foreground">Held (Pending)</span>
              <span className="font-mono text-sm text-muted-foreground">{formatNgn(ngnBalance.heldNgn)}</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="stake-ngn-amount" className="text-sm font-bold text-foreground">Amount (NGN)</Label>
          <Input
            id="stake-ngn-amount"
            type="number"
            placeholder="Enter amount in NGN"
            value={stakeAmount}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "" || !isNaN(Number(val))) {
                setStakeAmount(val);
              }
            }}
            min={100}
            max={ngnBalance.availableNgn}
            className="border-2 border-foreground/20 rounded-xl"
            disabled={isStaking}
          />
          <p className="text-xs text-muted-foreground">
            Min: ₦100 · Max: {formatNgn(ngnBalance.availableNgn)}
          </p>
        </div>

        {status && (
          <div
            className={`flex items-start gap-2.5 rounded-xl border p-4 text-sm ${
              status.includes("Failed") || status.includes("Insufficient")
                ? "border-destructive/20 bg-destructive/5 text-destructive"
                : "border-primary/20 bg-primary/5 text-primary"
            }`}
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{status}</span>
          </div>
        )}

        <Button
          onClick={handleStake}
          disabled={isStaking || !stakeAmount || Number(stakeAmount) <= 0}
          className="w-full h-11 border-2 border-primary bg-primary font-bold shadow-md hover:shadow-lg transition-all rounded-xl text-primary-foreground disabled:opacity-50"
        >
          {isStaking ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing transaction...
            </>
          ) : (
            "Stake from NGN Balance"
          )}
        </Button>
      </div>
    );
  } else {
    ngnBalanceTabContent = (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Failed to load NGN balance</p>
      </div>
    );
  }

  return (
    <Card className="border-2 border-foreground/10 bg-card shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-primary/5 via-transparent to-transparent pb-4">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg font-black text-foreground">Stake & Earn Yield</CardTitle>
        </div>
        <CardDescription>
          Choose your funding source, lock-in period, and secure guaranteed yields
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-2">
        
        {/* Estimated APY Preview & Lock Period Selector */}
        <div className="space-y-3">
          <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
            Select Lock Duration & Yield Boost
            <TooltipProvider>
              <Tooltip delayDuration={100}>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="More information about lock duration" className="text-muted-foreground hover:text-foreground focus:outline-none">
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs border border-foreground/10 bg-card p-3 shadow-md rounded-lg">
                  <p className="text-xs leading-relaxed text-card-foreground">
                    Locking tokens for longer durations optimizes platform liquidity, giving you access to higher locked APY yield multipliers.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {LOCK_PERIODS.map((lock) => {
              const isSelected = selectedLock.days === lock.days;
              return (
                <button
                  key={lock.days}
                  type="button"
                  onClick={() => handleLockSelect(lock)}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all text-center focus:outline-none ${
                    isSelected
                      ? "border-primary bg-primary/5 text-primary font-bold"
                      : "border-foreground/10 bg-card hover:border-foreground/20 text-muted-foreground"
                  }`}
                >
                  <span className="text-xs tracking-wide">{lock.label}</span>
                  <span className="text-sm font-black mt-1 text-foreground">{lock.apy.toFixed(1)}% APY</span>
                  {isSelected && (
                    <span className="mt-1 rounded-full bg-primary/20 p-0.5 text-[8px] text-primary flex items-center justify-center">
                      <Check className="h-2 w-2" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic Estimated Returns Calculator Box */}
        {estimate && (
          <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-primary uppercase tracking-wider">Estimated Returns ({selectedLock.days} days)</span>
              <span className="text-xs font-mono font-bold text-foreground">APY: {selectedLock.apy.toFixed(1)}%</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground uppercase">Principal</span>
                <p className="font-mono text-sm font-bold text-foreground">{formatUsdc(estimate.principal)}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase">Yield Earned</span>
                <p className="font-mono text-sm font-black text-emerald-600 dark:text-emerald-400">+{formatUsdc(estimate.interest)}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground uppercase">Total Payback</span>
                <p className="font-mono text-sm font-bold text-foreground">{formatUsdc(estimate.total)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Funding Method Tabs */}
        <Tabs value={stakingMode} onValueChange={(v) => setStakingMode(v as any)} className="w-full">
          <TabsList className="grid w-full grid-cols-3 border border-foreground/10 bg-muted/50 p-1 rounded-xl">
            <TabsTrigger value="ngn_deposit" className="rounded-lg text-xs font-bold data-[state=active]:bg-card">
              <DollarSign className="h-3.5 w-3.5 mr-1 text-primary" />
              NGN Deposit
            </TabsTrigger>
            <TabsTrigger value="ngn_balance" className="rounded-lg text-xs font-bold data-[state=active]:bg-card">
              <Wallet className="h-3.5 w-3.5 mr-1 text-primary" />
              NGN Balance
            </TabsTrigger>
            <TabsTrigger value="usdc" className="rounded-lg text-xs font-bold data-[state=active]:bg-card">
              <Coins className="h-3.5 w-3.5 mr-1 text-primary" />
              USDC Directly
            </TabsTrigger>
          </TabsList>

          {/* NGN Deposit Tab Content */}
          <TabsContent value="ngn_deposit" className="mt-4 focus:outline-none">
            {showNgnFlow && ngnQuote ? (
              <NgnStakingFlow
                initialQuote={ngnQuote}
                onComplete={handleNgnFlowComplete}
                onCancel={handleNgnFlowCancel}
              />
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-foreground/5 bg-muted/10 p-3.5 text-xs text-muted-foreground flex gap-2">
                  <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                  <span>
                    Deposit NGN from any local bank account. Your funds will automatically be converted to USDC and immediately staked.
                  </span>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ngn-deposit-amount" className="text-sm font-bold text-foreground">Amount (NGN)</Label>
                  <Input
                    id="ngn-deposit-amount"
                    type="number"
                    placeholder="Enter amount in NGN"
                    value={ngnDepositAmount}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || !isNaN(Number(val))) {
                        setNgnDepositAmount(val);
                        setQuoteError(null);
                      }
                    }}
                    min={100}
                    className="border-2 border-foreground/20 rounded-xl"
                    disabled={isLoadingQuote}
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum: ₦100
                  </p>
                </div>

                {quoteError && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{quoteError}</span>
                  </div>
                )}

                <Button
                  onClick={handleGetQuote}
                  disabled={isLoadingQuote || !ngnDepositAmount || Number(ngnDepositAmount) < 100}
                  className="w-full h-11 border-2 border-primary bg-primary font-bold shadow-md hover:shadow-lg transition-all rounded-xl text-primary-foreground disabled:opacity-50"
                >
                  {isLoadingQuote ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Requesting FX Quote...
                    </>
                  ) : (
                    <span className="flex items-center justify-center gap-1.5">
                      Request FX Quote & Stake <ArrowRight className="h-4 w-4" />
                    </span>
                  )}
                </Button>
              </div>
            )}
          </TabsContent>

          {/* NGN Balance Tab Content */}
          <TabsContent value="ngn_balance" className="mt-4 focus:outline-none">
            {ngnBalanceTabContent}
          </TabsContent>

          {/* USDC Directly Tab Content */}
          <TabsContent value="usdc" className="mt-4 focus:outline-none">
            <div className="space-y-4">
              <div className="rounded-xl border border-foreground/5 bg-muted/10 p-3.5 text-xs text-muted-foreground flex gap-2">
                <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                <span>
                  Stake USDC tokens directly from your Stellar freighter wallet. Ensure you have freighter wallet open and connected.
                </span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="stake-usdc-amount" className="text-sm font-bold text-foreground">Amount (USDC)</Label>
                <Input
                  id="stake-usdc-amount"
                  type="text"
                  placeholder="Enter amount in USDC"
                  value={stakeAmount}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || !isNaN(Number(val))) {
                      setStakeAmount(val);
                    }
                  }}
                  className="border-2 border-foreground/20 rounded-xl"
                  disabled={isStaking}
                />
                <p className="text-xs text-muted-foreground">
                  Enter the amount in USDC (e.g. 100.500000)
                </p>
              </div>

              {status && (
                <div
                  className={`flex items-start gap-2.5 rounded-xl border p-4 text-sm ${
                    status.includes("Failed") || status.includes("Enter a valid")
                      ? "border-destructive/20 bg-destructive/5 text-destructive"
                      : "border-primary/20 bg-primary/5 text-primary"
                  }`}
                >
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{status}</span>
                </div>
              )}

              <Button
                onClick={handleStake}
                disabled={isStaking || !stakeAmount || Number(stakeAmount) <= 0}
                className="w-full h-11 border-2 border-primary bg-primary font-bold shadow-md hover:shadow-lg transition-all rounded-xl text-primary-foreground disabled:opacity-50"
              >
                {isStaking ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing Stake transaction...
                  </>
                ) : (
                  "Stake USDC Directly"
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
