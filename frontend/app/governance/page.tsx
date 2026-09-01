"use client";

import { useState, useEffect } from "react";
import { Vote, Users, Loader2, RefreshCw, PlusCircle, CheckCircle2, XCircle, PlayCircle } from "lucide-react";
import { useGovernance } from "@/hooks/useGovernance";
import { useWallet } from "@/contexts/WalletContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GovernanceProposal } from "@/lib/governanceApi";
import { formatDateTime } from "@/lib/date";

const STATUS_STYLES: Record<GovernanceProposal["status"], string> = {
  Active: "bg-accent text-accent-foreground",
  Passed: "bg-secondary text-secondary-foreground",
  Rejected: "bg-destructive text-destructive-foreground",
  Executed: "bg-primary text-primary-foreground",
  Cancelled: "bg-muted text-muted-foreground",
};

function formatTimestamp(seconds: number): string {
  if (!seconds) return "—";
  return formatDateTime(seconds * 1000);
}

function ProposalCard({
  proposal,
  onVote,
  onFinalize,
  onExecute,
  isSubmitting,
}: {
  proposal: GovernanceProposal;
  onVote: (id: number, support: boolean) => void;
  onFinalize: (id: number) => void;
  onExecute: (id: number) => void;
  isSubmitting: boolean;
}) {
  // Date.now() must not be called during render (React Compiler purity rule),
  // so the "is voting closed" flag is derived in an effect instead.
  const [votingClosed, setVotingClosed] = useState(false);
  useEffect(() => {
    const check = () => setVotingClosed(Date.now() / 1000 > proposal.votingEndsAt);
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [proposal.votingEndsAt]);

  return (
    <Card className="border-3 border-foreground p-5 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] bg-card">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`border-2 border-foreground font-bold px-2 py-0.5 ${STATUS_STYLES[proposal.status]}`}>
              {proposal.status}
            </Badge>
            <span className="font-mono text-sm font-bold bg-muted px-2 py-0.5 border-2 border-foreground">
              #{proposal.id} {proposal.paramKey}
            </span>
          </div>

          <p className="text-sm font-bold">
            {proposal.currentValue} <span className="text-muted-foreground">&rarr;</span> {proposal.proposedValue}
          </p>

          <div className="flex items-center gap-4 pt-1 text-xs font-bold text-muted-foreground">
            <span>For: {proposal.votesFor}</span>
            <span>Against: {proposal.votesAgainst}</span>
            <span>Voting ends: {formatTimestamp(proposal.votingEndsAt)}</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 min-w-[180px]">
          {proposal.status === "Active" && !votingClosed && (
            <div className="flex gap-2 w-full">
              <Button
                className="flex-1 font-bold border-2 border-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                variant="default"
                size="sm"
                disabled={isSubmitting}
                onClick={() => onVote(proposal.id, true)}
              >
                <CheckCircle2 className="w-4 h-4 mr-1" />
                For
              </Button>
              <Button
                className="flex-1 font-bold border-2 border-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                variant="destructive"
                size="sm"
                disabled={isSubmitting}
                onClick={() => onVote(proposal.id, false)}
              >
                <XCircle className="w-4 h-4 mr-1" />
                Against
              </Button>
            </div>
          )}

          {proposal.status === "Active" && votingClosed && (
            <Button
              className="w-full font-bold border-2 border-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              variant="secondary"
              size="sm"
              disabled={isSubmitting}
              onClick={() => onFinalize(proposal.id)}
            >
              Finalize
            </Button>
          )}

          {proposal.status === "Passed" && (
            <Button
              className="w-full font-bold border-2 border-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              variant="default"
              size="sm"
              disabled={isSubmitting}
              onClick={() => onExecute(proposal.id)}
            >
              <PlayCircle className="w-4 h-4 mr-1" />
              Execute
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function ProposeForm({
  onSubmit,
  isSubmitting,
  disabled,
}: {
  onSubmit: (params: { paramKey: string; currentValue: string; proposedValue: string }) => void;
  isSubmitting: boolean;
  disabled: boolean;
}) {
  const [paramKey, setParamKey] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [proposedValue, setProposedValue] = useState("");

  return (
    <Card className="border-4 border-foreground p-8 bg-card shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
      <h3 className="text-xl font-black uppercase mb-4 flex items-center gap-2">
        <PlusCircle className="w-5 h-5" />
        Propose a Parameter Change
      </h3>
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="paramKey">Parameter key</Label>
          <Input
            id="paramKey"
            placeholder="e.g. min_stake"
            value={paramKey}
            onChange={(e) => setParamKey(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="currentValue">Current value</Label>
          <Input
            id="currentValue"
            placeholder="100"
            value={currentValue}
            onChange={(e) => setCurrentValue(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="proposedValue">Proposed value</Label>
          <Input
            id="proposedValue"
            placeholder="200"
            value={proposedValue}
            onChange={(e) => setProposedValue(e.target.value)}
            disabled={disabled}
          />
        </div>
        <Button
          className="w-full font-black border-2 border-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
          disabled={disabled || isSubmitting || !paramKey || !currentValue || !proposedValue}
          onClick={() => {
            onSubmit({ paramKey, currentValue, proposedValue });
            setParamKey("");
            setCurrentValue("");
            setProposedValue("");
          }}
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Submit Proposal
        </Button>
        {disabled && (
          <p className="text-xs font-bold text-muted-foreground">
            Connect a wallet with a staked balance to propose a change.
          </p>
        )}
      </div>
    </Card>
  );
}

export default function GovernancePage() {
  const { connected, connect, connecting, publicKey } = useWallet();
  const {
    proposals,
    isLoading,
    isSubmitting,
    stakedBalance,
    fetchProposals,
    createProposal,
    castVote,
    finalizeProposal,
    executeProposal,
  } = useGovernance();

  const hasStake = stakedBalance !== null && Number(stakedBalance) > 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-4 border-foreground bg-card p-6 md:p-10">
        <div className="container mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Vote className="w-8 h-8 md:w-10 md:h-10 text-primary" />
              <h1 className="text-3xl md:text-5xl font-black tracking-tighter uppercase italic">
                Stake-Weighted <span className="text-primary">Governance</span>
              </h1>
            </div>
            <p className="text-lg font-bold text-muted-foreground max-w-2xl">
              Propose and vote on protocol parameters, weighted by staked balance. This is a
              separate feature from the timelock admin queue.
            </p>
            {connected && (
              <p className="text-sm font-bold">
                Connected: <span className="font-mono">{publicKey}</span>
                {" · "}
                Staked: {stakedBalance ?? "…"}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 md:items-end">
            {!connected && (
              <Button
                onClick={connect}
                disabled={connecting}
                className="w-full md:w-auto h-16 px-8 text-xl font-black border-4 border-foreground shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]"
              >
                {connecting ? <Loader2 className="animate-spin w-6 h-6 mr-2" /> : null}
                Connect Wallet
              </Button>
            )}
            <Button
              onClick={fetchProposals}
              variant="secondary"
              className="w-full md:w-auto h-12 px-6 font-black border-2 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              {isLoading ? <Loader2 className="animate-spin w-5 h-5 mr-2" /> : <RefreshCw className="w-5 h-5 mr-2" />}
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 md:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          <div className="lg:col-span-2 space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black uppercase flex items-center gap-3">
                <Users className="w-6 h-6" />
                Proposals
                <span className="bg-foreground text-background px-3 py-1 text-sm rounded-full">
                  {proposals.length}
                </span>
              </h2>
            </div>

            {isLoading && proposals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 border-3 border-dashed border-foreground rounded-lg bg-muted/20">
                <Loader2 className="w-12 h-12 animate-spin text-muted-foreground mb-4" />
                <p className="font-bold text-muted-foreground">Fetching proposals...</p>
              </div>
            ) : proposals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 border-4 border-foreground bg-card shadow-[8px_8px_0px_0px_rgba(26,26,26,1)] text-center px-6">
                <div className="bg-secondary p-6 rounded-full border-4 border-foreground mb-6">
                  <Vote className="w-16 h-16" />
                </div>
                <h3 className="text-2xl font-black uppercase mb-2">No Proposals Yet</h3>
                <p className="font-bold text-muted-foreground max-w-sm">
                  Nobody has proposed a parameter change. Stakers can create the first one.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    onVote={castVote}
                    onFinalize={finalizeProposal}
                    onExecute={executeProposal}
                    isSubmitting={isSubmitting}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-8">
            <ProposeForm onSubmit={createProposal} isSubmitting={isSubmitting} disabled={!connected || !hasStake} />

            <Card className="border-4 border-foreground p-8 bg-primary shadow-[8px_8px_0px_0px_rgba(26,26,26,1)] text-primary-foreground">
              <h3 className="text-2xl font-black uppercase mb-4">How it works</h3>
              <ul className="space-y-4 font-bold">
                <li className="flex gap-3">
                  <span className="bg-foreground text-background w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">1</span>
                  <span>A staked wallet proposes a parameter change.</span>
                </li>
                <li className="flex gap-3">
                  <span className="bg-foreground text-background w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">2</span>
                  <span>Stakers vote for or against, weighted by their staked balance.</span>
                </li>
                <li className="flex gap-3">
                  <span className="bg-foreground text-background w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">3</span>
                  <span>Once voting ends, anyone can finalize the outcome.</span>
                </li>
                <li className="flex gap-3">
                  <span className="bg-foreground text-background w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">4</span>
                  <span>A passed proposal can be executed after its timelock elapses.</span>
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
