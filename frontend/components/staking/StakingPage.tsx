"use client";

import { claimRewards, getStakingPosition, stakeTokens, StakingPositionReponse, unstakeTokens, stakeFromNgnBalance } from "@/lib/config";
import { getNgnBalance, type NgnBalanceResponse } from "@/lib/walletApi";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Loader2, Wallet, Coins, AlertCircle, DollarSign } from "lucide-react";
import { useRiskState } from "@/hooks/useRiskState";
import { ACCOUNT_FROZEN_MESSAGE, isAccountFrozenError } from "@/lib/api";
import { handleError } from "@/lib/toast";
import FrozenAccountBanner from "../FrozenAccountBanner";
import { getQuote, type Quote, type StakingPosition as NgnStakingPosition } from "@/lib/ngnStakingApi";
import { NgnStakingFlow } from "./ngn-flow/NgnStakingFlow";

type StakingMode = "ngn_deposit" | "ngn_balance" | "usdc";

export default function StakingPage() {
  const { isFrozen, freezeReason } = useRiskState();
  const [stakingPosition, setStakingPosition] = useState<StakingPositionReponse | null>(null);
  const [ngnBalance, setNgnBalance] = useState<NgnBalanceResponse | null>(null);
  const [stakingMode, setStakingMode] = useState<StakingMode>("ngn_balance");
  const [stakeAmount, setStakeAmount] = useState("");
  const [unstakeAmount, setUnstakeAmount] = useState("");
  const [status, setStatus] = useState("");
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [isStaking, setIsStaking] = useState(false);

  // NGN Deposit flow state
  const [ngnDepositAmount, setNgnDepositAmount] = useState("");
  const [ngnQuote, setNgnQuote] = useState<Quote | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [showNgnFlow, setShowNgnFlow] = useState(false);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_BACKEND_URL) {
      return;
    }

    getStakingPosition()
      .then((data) => setStakingPosition(data))
      .catch((err: Error) => {
        console.error("Failed to fetch staking position", err);
      });
  }, []);

  useEffect(() => {
    if (stakingMode === "ngn_balance") {
      setIsLoadingBalance(true);
      getNgnBalance()
        .then((balance) => setNgnBalance(balance))
        .catch((err: Error) => {
          console.error("Failed to fetch NGN balance", err);
          setStatus("Failed to load NGN balance");
        })
        .finally(() => setIsLoadingBalance(false));
    }
  }, [stakingMode]);





  //  This function handles balance state in the staking page
  const updatePosition = (updates: {
    stakedDelta?: number
    claimableDelta?: number
  }) => {
    setStakingPosition((prev) => {
      if (!prev) return prev

      const currentStaked = Number(prev.position.staked)
      const currentClaimable = Number(prev.position.claimable)

      return {
        ...prev,
        position: {
          staked: (
            currentStaked + (updates.stakedDelta ?? 0)
          ).toFixed(6),
          claimable: (
            currentClaimable + (updates.claimableDelta ?? 0)
          ).toFixed(6),
        },
      }
    })
  }




  // Function to stake token
  const handleStake = async () => {
    if (!stakeAmount || Number(stakeAmount) <= 0) {
      setStatus("Enter a valid amount to stake")
      return
    }

    const amount = Number(stakeAmount)

    if (isFrozen && stakingMode === "ngn_balance") {
      setStatus(ACCOUNT_FROZEN_MESSAGE);
      handleError(new Error(ACCOUNT_FROZEN_MESSAGE), ACCOUNT_FROZEN_MESSAGE);
      return;
    }

    // Validate NGN balance if staking from NGN
    if (stakingMode === "ngn_balance") {
      if (!ngnBalance || amount > ngnBalance.availableNgn) {
        setStatus(`Insufficient NGN balance. Available: ₦${ngnBalance?.availableNgn.toLocaleString() || 0}`)
        return
      }
    }

    setIsStaking(true)
    setStatus("")

    try {
      if (stakingMode === "ngn_balance") {
        setStatus("Converting NGN to USDC and staking...")
        const res = await stakeFromNgnBalance(amount)

        if (res.status === "CONFIRMED") {
          setStatus(`Successfully staked ${res.amountUsdc || amount} USDC from ₦${amount.toLocaleString()}`)
          // Refresh NGN balance
          const updatedBalance = await getNgnBalance()
          setNgnBalance(updatedBalance)
          // Refresh staking position
          const updatedPosition = await getStakingPosition()
          setStakingPosition(updatedPosition)
        } else {
          setStatus("Staking queued for processing")
        }

        setStakeAmount("")
      } else {
        setStatus("Submitting stake transaction...")
        const res = await stakeTokens(stakeAmount)

        if (res.status === "CONFIRMED") {
          setStatus("Stake confirmed on-chain")
        } else {
          setStatus("Stake queued for retry")
        }

        // Add to staked balance
        updatePosition({ stakedDelta: amount })
        setStakeAmount("")
      }
    } catch (err: any) {
      if (isAccountFrozenError(err)) {
        setStatus(ACCOUNT_FROZEN_MESSAGE);
      } else {
        setStatus(err.message || "Stake failed");
      }
      handleError(err, "Stake failed");
    } finally {
      setIsStaking(false)
    }
  }



  //  Function to unstake token
  const handleUnstake = async () => {
    if (!unstakeAmount || Number(unstakeAmount) <= 0) {
      setStatus("Enter a valid amount to unstake")
      return
    }

    const amount = Number(unstakeAmount)

    try {
      setStatus("Submitting unstake transaction...")

      const res = await unstakeTokens(unstakeAmount)

      if (res.status === "CONFIRMED") {
        setStatus("Unstake confirmed on-chain")
      } else {
        setStatus("Unstake queued for retry")
      }

      // Subtract from staked
      updatePosition({ stakedDelta: -amount })

      setUnstakeAmount("")

    } catch (err: any) {
      setStatus(err.message || "Unstake failed");
      handleError(err, "Unstake failed");
    }
  }



  //  Function to claim token
  const handleClaim = async () => {
    try {
      setStatus("Claiming rewards...")

      const claimable = Number(stakingPosition?.position.claimable ?? 0)

      const res = await claimRewards()

      if (res.status === "CONFIRMED") {
        setStatus("Rewards claimed")
      } else {
        setStatus("Claim queued for retry")
      }

      // Remove claimable rewards
      updatePosition({ claimableDelta: -claimable })

    } catch (err: any) {
      setStatus(err.message || "Claim failed");
      handleError(err, "Claim failed");
    }
  }


  const handleStakeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;

    // Allow empty string to let user clear input
    if (value === '' || !isNaN(Number(value))) {
      setStakeAmount(value);
    }
  }


  const handleUnstakeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;

    // Allow empty string to let user clear input
    if (value === '' || !isNaN(Number(value))) {
      setUnstakeAmount(value);
    }
  }

  const handleNgnDepositInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    if (value === '' || !isNaN(Number(value))) {
      setNgnDepositAmount(value);
      setQuoteError(null);
    }
  }

  const handleGetQuote = async () => {
    const amount = Number(ngnDepositAmount);
    if (!amount || amount < 100) {
      setQuoteError("Minimum amount is ₦100");
      return;
    }

    setIsLoadingQuote(true);
    setQuoteError(null);

    try {
      const quote = await getQuote(amount);
      setNgnQuote(quote);
      setShowNgnFlow(true);
    } catch (error) {
      setQuoteError(error instanceof Error ? error.message : "Failed to get quote");
    } finally {
      setIsLoadingQuote(false);
    }
  }

  const handleNgnFlowComplete = (position: NgnStakingPosition) => {
    // Refresh staking position
    getStakingPosition()
      .then((data) => setStakingPosition(data))
      .catch((err: Error) => {
        console.error("Failed to refresh staking position", err);
      });

    // Reset flow
    setShowNgnFlow(false);
    setNgnQuote(null);
    setNgnDepositAmount("");
    setStatus(`Successfully staked ${position.amount} USDC`);
  }

  const handleNgnFlowCancel = () => {
    setShowNgnFlow(false);
    setNgnQuote(null);
  }




  const formatNgn = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(amount);
  };


  const deficit = ngnBalance ? Math.max(0, -ngnBalance.totalNgn) : 0;

  let ngnBalanceTabContent: React.ReactNode;
  if (isFrozen) {
    ngnBalanceTabContent = (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
        <p className="font-semibold text-destructive">{ACCOUNT_FROZEN_MESSAGE}</p>
        <p className="mt-1 text-sm text-destructive">
          Top up NGN wallet to repay deficit
        </p>
        <Button asChild className="mt-3 border-2 border-foreground bg-primary font-bold">
          <Link href="/wallet">Go to wallet</Link>
        </Button>
      </div>
    );
  } else if (isLoadingBalance) {
    ngnBalanceTabContent = (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  } else if (ngnBalance) {
    ngnBalanceTabContent = (
      <>
        <div className="rounded-md border-2 border-foreground/20 bg-muted p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Available NGN Balance</span>
            <span className="font-mono font-bold">{formatNgn(ngnBalance.availableNgn)}</span>
          </div>
          {ngnBalance.heldNgn > 0 && (
            <div className="flex items-center justify-between mt-2">
              <span className="text-sm text-muted-foreground">Held (Pending)</span>
              <span className="font-mono text-sm">{formatNgn(ngnBalance.heldNgn)}</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="stake-ngn-amount">Amount (NGN)</Label>
          <Input
            id="stake-ngn-amount"
            type="number"
            placeholder="Enter amount in NGN"
            value={stakeAmount}
            onChange={handleStakeInput}
            min={100}
            max={ngnBalance.availableNgn}
            className="border-2 border-foreground"
            disabled={isStaking}
          />
          <p className="text-xs text-muted-foreground">
            Min: ₦100 · Max: {formatNgn(ngnBalance.availableNgn)}
          </p>
        </div>

        {status && (
          <div
            className={`flex items-start gap-2 rounded-md border p-3 text-sm ${status.includes("Failed") || status.includes("Insufficient")
              ? "border-destructive/20 bg-destructive/10 text-destructive"
              : "border-blue-200 bg-blue-50 text-blue-800"
              }`}
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{status}</span>
          </div>
        )}

        <Button
          onClick={handleStake}
          disabled={isStaking || !stakeAmount || Number(stakeAmount) <= 0}
          className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
        >
          {isStaking ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            "Stake from NGN Balance"
          )}
        </Button>
      </>
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
    <div className="max-w-4xl mx-auto p-6 relative ">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Staking Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Stake your tokens to earn rewards
        </p>
      </div>

      {isFrozen && (
        <div className="mb-6">
          <FrozenAccountBanner
            freezeReason={freezeReason}
            deficit={deficit}
            ctaHref="/wallet"
            ctaLabel="Top up NGN wallet to repay deficit"
          />
        </div>
      )}

      {/* Staking Position Cards */}
      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <CardHeader className="pb-2">
            <CardDescription>Staked Balance</CardDescription>
            <CardTitle className="font-mono text-2xl">
              {stakingPosition ? (
                `${Number(stakingPosition.position.staked).toFixed(2)} USDC`
              ) : (
                "—"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">Currently staked</p>
          </CardContent>
        </Card>

        <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <CardHeader className="pb-2">
            <CardDescription>Claimable Rewards</CardDescription>
            <CardTitle className="font-mono text-2xl text-primary">
              {stakingPosition ? (
                `${Number(stakingPosition.position.claimable).toFixed(2)} USDC`
              ) : (
                "—"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">Available to claim</p>
          </CardContent>
        </Card>
      </div>

      {/* Staking Mode Toggle */}
      <Tabs value={stakingMode} onValueChange={(v) => setStakingMode(v as StakingMode)} className="mb-6">
        <TabsList className="grid w-full grid-cols-3 border-3 border-foreground">
          <TabsTrigger value="ngn_deposit" className="data-[state=active]:bg-primary">
            <DollarSign className="h-4 w-4 mr-2" />
            NGN Deposit
          </TabsTrigger>
          <TabsTrigger value="ngn_balance" className="data-[state=active]:bg-primary">
            <Wallet className="h-4 w-4 mr-2" />
            NGN Balance
          </TabsTrigger>
          <TabsTrigger value="usdc" className="data-[state=active]:bg-primary">
            <Coins className="h-4 w-4 mr-2" />
            USDC (Advanced)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ngn_deposit" className="mt-4">
          {showNgnFlow && ngnQuote ? (
            <NgnStakingFlow
              initialQuote={ngnQuote}
              onComplete={handleNgnFlowComplete}
              onCancel={handleNgnFlowCancel}
            />
          ) : (
            <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <CardHeader>
                <CardTitle>Stake with NGN Deposit</CardTitle>
                <CardDescription>
                  Deposit NGN via bank transfer or Paystack, convert to USDC, and stake
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ngn-deposit-amount">Amount (NGN)</Label>
                  <Input
                    id="ngn-deposit-amount"
                    type="number"
                    placeholder="Enter amount in NGN"
                    value={ngnDepositAmount}
                    onChange={handleNgnDepositInput}
                    min={100}
                    className="border-2 border-foreground"
                    disabled={isLoadingQuote}
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum: ₦100
                  </p>
                </div>

                {quoteError && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{quoteError}</span>
                  </div>
                )}

                <Button
                  onClick={handleGetQuote}
                  disabled={isLoadingQuote || !ngnDepositAmount || Number(ngnDepositAmount) < 100}
                  className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
                >
                  {isLoadingQuote ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Getting Quote...
                    </>
                  ) : (
                    "Get Quote"
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="ngn_balance" className="mt-4">
          <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <CardHeader>
              <CardTitle>Stake from NGN Balance</CardTitle>
              <CardDescription>
                Convert your NGN wallet balance to USDC and stake it
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {ngnBalanceTabContent}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usdc" className="mt-4">
          <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <CardHeader>
              <CardTitle>Stake USDC Directly</CardTitle>
              <CardDescription>
                Stake USDC tokens directly (requires USDC in your wallet)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="stake-usdc-amount">Amount (USDC)</Label>
                <Input
                  id="stake-usdc-amount"
                  type="text"
                  placeholder="Enter amount in USDC"
                  value={stakeAmount}
                  onChange={handleStakeInput}
                  className="border-2 border-foreground"
                  disabled={isStaking}
                />
                <p className="text-xs text-muted-foreground">
                  Enter the amount in USDC (e.g., 100.50)
                </p>
              </div>

              {status && (
                <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${status.includes("Failed") || status.includes("Enter a valid")
                  ? "border-destructive/20 bg-destructive/10 text-destructive"
                  : "border-blue-200 bg-blue-50 text-blue-800"
                  }`}>
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{status}</span>
                </div>
              )}

              <Button
                onClick={handleStake}
                disabled={isStaking || !stakeAmount || Number(stakeAmount) <= 0}
                className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
              >
                {isStaking ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Stake USDC"
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Unstake Form */}
      <Card className="mb-6 border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <CardHeader>
          <CardTitle>Unstake Tokens</CardTitle>
          <CardDescription>Unstake your USDC tokens from the staking pool</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="unstake-amount">Amount (USDC)</Label>
            <Input
              id="unstake-amount"
              type="text"
              placeholder="Enter amount to unstake"
              value={unstakeAmount}
              onChange={handleUnstakeInput}
              className="border-2 border-foreground"
            />
            <p className="text-xs text-muted-foreground">
              Maximum: {stakingPosition ? Number(stakingPosition.position.staked).toFixed(2) : "0"} USDC
            </p>
          </div>

          <Button
            onClick={handleUnstake}
            disabled={!unstakeAmount || Number(unstakeAmount) <= 0}
            className="w-full border-3 border-foreground bg-destructive font-bold text-destructive-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
          >
            Unstake Tokens
          </Button>
        </CardContent>
      </Card>

      {/* Claim Rewards */}
      <Card className="mb-6 border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <CardHeader>
          <CardTitle>Claim Rewards</CardTitle>
          <CardDescription>
            Claim your staking rewards ({stakingPosition ? Number(stakingPosition.position.claimable).toFixed(2) : "0"} USDC available)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleClaim}
            disabled={!stakingPosition || Number(stakingPosition.position.claimable) <= 0}
            className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
          >
            Claim Rewards
          </Button>
        </CardContent>
      </Card>

    </div>
  );
}
