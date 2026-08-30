"use client";

import {
  getMvpStakingPosition,
  MvpStakingPositionResponse,
  stakeTokens,
  unstakeTokens,
  stakeFromNgnBalance,
} from "@/lib/config";
import { getNgnBalance, type NgnBalanceResponse } from "@/lib/walletApi";
import { useStakingPosition } from "@/hooks/useStakingPosition";
import React, { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Loader2, Wallet, AlertCircle, Clock, Lock } from "lucide-react";
import { useRiskState } from "@/hooks/useRiskState";
import { ACCOUNT_FROZEN_MESSAGE, isAccountFrozenError } from "@/lib/api";
import { handleError } from "@/lib/toast";
import FrozenAccountBanner from "../FrozenAccountBanner";
import { getQuote, type Quote } from "@/lib/ngnStakingApi";
import { UnstakeModal } from "./unstake-modal";
import { PositionCard, formatUsdc } from "./PositionCard";
import { StakeForm } from "./StakeForm";
import { HistoryTable } from "./HistoryTable";
import { DelegationPanel } from "./DelegationPanel";
import { StakingClaimFlow } from "./StakingClaimFlow";
import { EpochRewardsPanel } from "./EpochRewardsPanel";
import { stellarWallet } from "@/lib/stellar-wallet";
import { walletAuthManager } from "@/lib/wallet-auth";
import { useCountdown } from "@/hooks/useCountdown";

type StakingMode = "ngn_deposit" | "ngn_balance" | "usdc";

export default function StakingPage() {
  const { isFrozen, freezeReason } = useRiskState();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const { position: stakingPosition, refetch: refetchStakingPosition } = useStakingPosition({
    walletAddress,
    enabled: !!walletAddress && !!process.env.NEXT_PUBLIC_BACKEND_URL,
  });
  const [mvpPosition, setMvpPosition] = useState<MvpStakingPositionResponse | null>(null);
  const [ngnBalance, setNgnBalance] = useState<NgnBalanceResponse | null>(null);
  const [stakingMode, setStakingMode] = useState<StakingMode>("ngn_balance");
  const [stakeAmount, setStakeAmount] = useState("");
  const [status, setStatus] = useState("");
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [isStaking, setIsStaking] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isClaimFlowOpen, setIsClaimFlowOpen] = useState(false);

  // NGN Deposit flow state
  const [ngnDepositAmount, setNgnDepositAmount] = useState("");
  const [ngnQuote, setNgnQuote] = useState<Quote | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [showNgnFlow, setShowNgnFlow] = useState(false);
  const [isUnstakeModalOpen, setIsUnstakeModalOpen] = useState(false);

  // Initialize and check wallet connection
  useEffect(() => {
    const session = walletAuthManager.getSession();
    if (session?.publicKey) {
      setWalletAddress(session.publicKey);
      if (!stellarWallet.getPublicKey()) {
        stellarWallet.connect().catch((err) => {
          console.warn("Freighter auto-connect failed:", err);
        });
      }
    } else if (stellarWallet.isConnected()) {
      setWalletAddress(stellarWallet.getPublicKey());
    }
  }, []);

  // Fetch MVP position when walletAddress changes
  useEffect(() => {
    if (!walletAddress || !process.env.NEXT_PUBLIC_BACKEND_URL) {
      return;
    }
    getMvpStakingPosition(walletAddress)
      .then((data) => setMvpPosition(data))
      .catch((err: Error) => console.error("Failed to fetch MVP staking position", err));
  }, [walletAddress]);

  useEffect(() => {
    if (walletAddress && stakingMode === "ngn_balance") {
      setIsLoadingBalance(true);
      getNgnBalance()
        .then((balance) => setNgnBalance(balance))
        .catch((err: Error) => {
          console.error("Failed to fetch NGN balance", err);
          setStatus("Failed to load NGN balance");
        })
        .finally(() => setIsLoadingBalance(false));
    }
  }, [walletAddress, stakingMode]);

  // Lock expiry countdown using custom hook
  const { timeLeft, formatTime, isExpired } = useCountdown(stakingPosition?.position?.lockExpiry);

  const handleConnectWallet = async () => {
    setIsConnecting(true);
    setStatus("");
    try {
      const walletInfo = await stellarWallet.connect();
      setWalletAddress(walletInfo.publicKey);
      setStatus("Wallet connected successfully!");
      setMvpPosition(await getMvpStakingPosition(walletInfo.publicKey));
    } catch (err: any) {
      setStatus(err.message || "Failed to connect Stellar wallet");
      handleError(err, "Failed to connect Stellar wallet");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleStake = async () => {
    if (!stakeAmount || Number(stakeAmount) <= 0) {
      setStatus("Enter a valid amount to stake");
      return;
    }

    const amount = Number(stakeAmount);

    if (isFrozen && stakingMode === "ngn_balance") {
      setStatus(ACCOUNT_FROZEN_MESSAGE);
      handleError(new Error(ACCOUNT_FROZEN_MESSAGE), ACCOUNT_FROZEN_MESSAGE);
      return;
    }

    if (stakingMode === "ngn_balance") {
      if (!ngnBalance || amount > ngnBalance.availableNgn) {
        // Only quote a figure we actually hold; an unloaded balance says so
        // rather than claiming the wallet has ₦0 available.
        setStatus(
          ngnBalance
            ? `Insufficient NGN balance. Available: ₦${ngnBalance.availableNgn.toLocaleString()}`
            : "We couldn't read your NGN balance. Please retry in a moment.",
        );
        return;
      }
    }

    setIsStaking(true);
    setStatus("");

    try {
      if (stakingMode === "ngn_balance") {
        setStatus("Converting NGN to USDC and staking...");
        const res = await stakeFromNgnBalance(amount);

        if (res.status === "CONFIRMED") {
          setStatus(`Successfully staked ${res.amountUsdc || amount} USDC from ₦${amount.toLocaleString()}`);
          const updatedBalance = await getNgnBalance();
          setNgnBalance(updatedBalance);
          refetchStakingPosition();
        } else {
          setStatus("Staking queued for processing");
        }

        setStakeAmount("");
      } else {
        setStatus("Submitting stake transaction...");
        const res = await stakeTokens(stakeAmount, walletAddress);

        if (res.status === "CONFIRMED") {
          setStatus("Stake confirmed on-chain");
        } else {
          setStatus("Stake queued for retry");
        }

        refetchStakingPosition();
        setMvpPosition(await getMvpStakingPosition(walletAddress));
        setStakeAmount("");
      }
    } catch (err: any) {
      if (isAccountFrozenError(err)) {
        setStatus(ACCOUNT_FROZEN_MESSAGE);
      } else {
        setStatus(err.message || "Stake failed");
      }
      handleError(err, "Stake failed");
    } finally {
      setIsStaking(false);
    }
  };

  const handleUnstake = async (amountToUnstake: string) => {
    const amount = Number(amountToUnstake);
    if (isNaN(amount) || amount <= 0) return;

    try {
      setStatus("Submitting unstake transaction...");

      const res = await unstakeTokens(amountToUnstake, walletAddress);

      if (res.status === "CONFIRMED") {
        setStatus("Unstake confirmed on-chain");
      } else {
        setStatus("Unstake queued for retry");
      }

      refetchStakingPosition();

    } catch (err: any) {
      setStatus(err.message || "Unstake failed");
      handleError(err, "Unstake failed");
      throw err;
    }
  };

  const handleClaimFlowClose = () => {
    setIsClaimFlowOpen(false);
    // The flow may have just claimed rewards on-chain — refresh the position
    // whether it did or not, so the claimable balance reflects reality.
    refetchStakingPosition();
  };

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
  };

  const handleNgnFlowComplete = (position: any) => {
    refetchStakingPosition();
    setShowNgnFlow(false);
    setNgnQuote(null);
    setNgnDepositAmount("");
    setStatus(`Successfully staked ${position.amount || ""} USDC`);
  };

  const handleNgnFlowCancel = () => {
    setShowNgnFlow(false);
    setNgnQuote(null);
  };

  const deficit = ngnBalance ? Math.max(0, -ngnBalance.totalNgn) : 0;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      
      {/* Dashboard Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-foreground/5 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">Staking Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Provide liquidity, secure NGN trade finance, and earn compounded rewards
          </p>
        </div>
        {walletAddress && (
          <div className="mt-3 sm:mt-0 flex items-center gap-2 border border-foreground/10 bg-muted/40 px-3 py-1.5 rounded-full text-xs font-mono text-muted-foreground w-fit">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-6)}
          </div>
        )}
      </div>

      {isFrozen && (
        <FrozenAccountBanner
          freezeReason={freezeReason}
          deficit={deficit}
          ctaHref="/wallet"
          ctaLabel="Top up NGN wallet to repay deficit"
        />
      )}

      {/* WALLET CONNECTION CHECK GATE CARD */}
      {!walletAddress ? (
        <Card className="max-w-md mx-auto border-3 border-foreground bg-card shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] overflow-hidden rounded-2xl my-8">
          <CardHeader className="bg-gradient-to-r from-primary/5 via-transparent to-transparent text-center border-b-2 border-foreground/10 pb-6">
            <div className="mx-auto rounded-full bg-primary/10 p-4 w-fit border border-primary/20 mb-4 animate-bounce">
              <Wallet className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-xl font-black">Connect Stellar Wallet</CardTitle>
            <CardDescription className="text-xs mt-1 leading-relaxed">
              Link your Freighter wallet to query lock balances, stake digital assets, and claim contract interest.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {status && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{status}</span>
              </div>
            )}
            
            <Button
              onClick={handleConnectWallet}
              disabled={isConnecting}
              className="w-full h-11 border-2 border-primary bg-primary text-primary-foreground font-bold shadow-sm hover:shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all rounded-xl"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting Freighter...
                </>
              ) : (
                <>
                  <Wallet className="mr-2 h-4 w-4" />
                  Connect Freighter Wallet
                </>
              )}
            </Button>

            <div className="text-[10px] text-muted-foreground text-center leading-relaxed">
              Stellar ledger operations require freighter web browser extension.
            </div>
          </CardContent>
        </Card>
      ) : (
        /* STAKING DASHBOARD BODY (AUTHORIZED STATE) */
        <div className="space-y-6">
          
          {/* Hero Stats — the directly staked staking_pool position. Delegated
              stake lives in a separate contract and is shown on its own below. */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Directly staked position
            </p>
            <PositionCard position={stakingPosition?.position || null} />
          </div>

          <DelegationPanel walletAddress={walletAddress} />

          <EpochRewardsPanel />

          <Card className="border-2 border-foreground/10 bg-card shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">MVP pool utilization</CardTitle>
              <CardDescription className="text-xs">
                Experimental pool balance, including stake reserved by an authorized protocol consumer.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Total staked", mvpPosition?.position.staked],
                ["Used", mvpPosition?.position.used],
                ["Unused", mvpPosition?.position.unused],
                ["Claimable", mvpPosition?.position.claimable],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-foreground/10 bg-muted/20 p-3">
                  <div className="text-[10px] font-bold uppercase text-muted-foreground">{label}</div>
                  <div className="mt-1 font-mono text-sm font-black">{value ?? "0.000000"} USDC</div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Action grid (Stake / Unstake / Claim) */}
          <div className="grid gap-6 md:grid-cols-12">
            
            {/* Stake Form */}
            <div className="md:col-span-8">
              <StakeForm
                isFrozen={isFrozen}
                isLoadingBalance={isLoadingBalance}
                isStaking={isStaking}
                ngnBalance={ngnBalance}
                stakeAmount={stakeAmount}
                setStakeAmount={setStakeAmount}
                handleStake={handleStake}
                stakingMode={stakingMode}
                setStakingMode={setStakingMode}
                status={status}
                setStatus={setStatus}
                ngnDepositAmount={ngnDepositAmount}
                setNgnDepositAmount={setNgnDepositAmount}
                ngnQuote={ngnQuote}
                setNgnQuote={setNgnQuote}
                isLoadingQuote={isLoadingQuote}
                setIsLoadingQuote={setIsLoadingQuote}
                quoteError={quoteError}
                setQuoteError={setQuoteError}
                showNgnFlow={showNgnFlow}
                setShowNgnFlow={setShowNgnFlow}
                handleGetQuote={handleGetQuote}
                handleNgnFlowComplete={handleNgnFlowComplete}
                handleNgnFlowCancel={handleNgnFlowCancel}
              />
            </div>

            {/* Unstake & Claim Panel */}
            <div className="md:col-span-4 space-y-6">
              
              {/* Unstake Panel */}
              <Card className="border-2 border-foreground/10 bg-card shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
                <CardHeader className="bg-muted/10 pb-4 border-b border-foreground/5">
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-primary" />
                    <CardTitle className="text-base font-bold text-foreground">Unstake Tokens</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    Reclaim staked USDC to your wallet balance
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Staked principal is subject to smart contract locks. Unstaking takes up to 7 days of cooling time before funds become available.
                  </p>

                  {/* Lock period expiration indicator */}
                  {!isExpired && (
                    <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-xs text-amber-600 dark:text-amber-500">
                      <Lock className="h-4 w-4 shrink-0" />
                      <div className="space-y-0.5">
                        <span className="font-bold">Staking locked</span>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          Unlocks in: {formatTime()}
                        </p>
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={() => setIsUnstakeModalOpen(true)}
                    disabled={!isExpired || !stakingPosition || Number(stakingPosition.position.staked) <= 0}
                    className={`w-full h-10 border-2 text-xs font-bold rounded-xl shadow-sm hover:shadow transition-all ${
                      isExpired
                        ? "border-destructive bg-destructive text-destructive-foreground"
                        : "border-muted bg-muted text-muted-foreground cursor-not-allowed"
                    }`}
                  >
                    {!isExpired ? (
                      <span className="flex items-center justify-center gap-1.5">
                        <Lock className="h-3.5 w-3.5" /> Unstake Locked ({formatTime()})
                      </span>
                    ) : (
                      "Unstake principal"
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Claim Rewards */}
              <Card className="border-2 border-foreground/10 bg-card shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
                <CardHeader className="bg-muted/10 pb-4 border-b border-foreground/5">
                  <div className="flex items-center gap-2">
                    <Lock className="h-5 w-5 text-emerald-500" />
                    <CardTitle className="text-base font-bold text-foreground">Claim Interest</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    Claim dynamically generated USDC interest yield
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                  <div className="rounded-xl border border-foreground/5 bg-muted/30 p-3.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground font-medium">Available Interest</span>
                    <span className="font-mono text-sm font-black text-emerald-600 dark:text-emerald-500">
                      {stakingPosition ? formatUsdc(stakingPosition.position.claimable) : "0.000000"} USDC
                    </span>
                  </div>

                  <Button
                    onClick={() => setIsClaimFlowOpen(true)}
                    disabled={!stakingPosition || Number(stakingPosition.position.claimable) <= 0}
                    className="w-full h-10 border-2 border-primary bg-primary text-primary-foreground text-xs font-bold rounded-xl shadow-sm hover:shadow transition-all disabled:opacity-50"
                  >
                    Claim accrued yield
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* History table */}
          <HistoryTable walletAddress={walletAddress} />

          <UnstakeModal
            isOpen={isUnstakeModalOpen}
            onClose={() => setIsUnstakeModalOpen(false)}
            onConfirm={handleUnstake}
            maxAmount={stakingPosition ? Number(stakingPosition.position.staked).toFixed(6) : "0.000000"}
            warmingAmount={stakingPosition ? Number(stakingPosition.position.warming).toFixed(6) : "0.000000"}
          />

          <StakingClaimFlow
            isOpen={isClaimFlowOpen}
            onClose={handleClaimFlowClose}
            rewardAmount={stakingPosition ? Number(stakingPosition.position.claimable) : 0}
          />
        </div>
      )}
    </div>
  );
}
