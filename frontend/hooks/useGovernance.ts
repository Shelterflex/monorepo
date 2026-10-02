import { useState, useEffect, useCallback } from "react";
import {
  listProposals,
  prepareCreateProposal,
  submitCreateProposal,
  prepareVote,
  submitVote,
  finalizeProposal as finalizeProposalRequest,
  executeProposal as executeProposalRequest,
  type GovernanceProposal,
} from "@/lib/governanceApi";
import { getStakingPosition } from "@/lib/config";
import { useWallet } from "@/contexts/WalletContext";
import { handleError, showSuccessToast } from "@/lib/toast";

/**
 * Drives the governance page (issue #1494): polls proposals, and wires the
 * prepare -> sign (connected wallet) -> submit flow for creating proposals
 * and voting. Mirrors useTimelock's polling shape; this is a different
 * feature (proposal/voting on contracts/governance) from the timelock admin
 * queue that hook drives.
 */
export function useGovernance() {
  const { publicKey, connected, signTransaction } = useWallet();
  const [proposals, setProposals] = useState<GovernanceProposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stakedBalance, setStakedBalance] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProposals = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await listProposals();
      setProposals(list);
    } catch (err) {
      handleError(err, "Failed to fetch governance proposals");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProposals();
    const interval = setInterval(fetchProposals, 15000);
    return () => clearInterval(interval);
  }, [fetchProposals]);

  // Reuses the same staking-position endpoint the staking page reads from, so
  // "gated on the connected wallet's stake" reflects the real staked balance
  // rather than a second, separate notion of stake.
  useEffect(() => {
    if (!connected || !publicKey) {
      setStakedBalance(null);
      return;
    }
    getStakingPosition(publicKey)
      .then((res) => setStakedBalance(res.position.staked))
      .catch(() => setStakedBalance(null));
  }, [connected, publicKey]);

  const createProposal = useCallback(
    async (params: { paramKey: string; currentValue: string; proposedValue: string }) => {
      setError(null);

      // Validate parameter key
      if (!params.paramKey || !params.paramKey.trim()) {
        const err = new Error("Parameter key is required");
        handleError(err, "Validation failed");
        setError(err.message);
        throw err;
      }

      // Validate currentValue is a valid number
      if (!params.currentValue || params.currentValue.trim() === "" || isNaN(Number(params.currentValue))) {
        const err = new Error("Current value must be a valid number");
        handleError(err, "Validation failed");
        setError(err.message);
        throw err;
      }

      // Validate proposedValue is a valid number
      if (!params.proposedValue || params.proposedValue.trim() === "" || isNaN(Number(params.proposedValue))) {
        const err = new Error("Proposed value must be a valid number");
        handleError(err, "Validation failed");
        setError(err.message);
        throw err;
      }

      if (!connected) {
        const err = new Error("Connect a wallet first");
        handleError(err, "Wallet not connected");
        setError(err.message);
        throw err;
      }

      setIsSubmitting(true);
      try {
        const xdr = await prepareCreateProposal(params);
        const signedXdr = await signTransaction(xdr);
        await submitCreateProposal(signedXdr);
        showSuccessToast("Proposal submitted");
        await fetchProposals();
      } catch (err: any) {
        const message = err?.message || "Failed to create proposal";
        setError(message);
        handleError(err, "Failed to create proposal");
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [connected, signTransaction, fetchProposals],
  );

  const castVote = useCallback(
    async (proposalId: number, support: boolean) => {
      if (!connected) {
        handleError(new Error("Connect a wallet first"), "Wallet not connected");
        return;
      }
      setIsSubmitting(true);
      try {
        const xdr = await prepareVote(proposalId, support);
        const signedXdr = await signTransaction(xdr);
        await submitVote(proposalId, signedXdr);
        showSuccessToast(support ? "Voted for the proposal" : "Voted against the proposal");
        await fetchProposals();
      } catch (err) {
        handleError(err, "Failed to submit vote");
      } finally {
        setIsSubmitting(false);
      }
    },
    [connected, signTransaction, fetchProposals],
  );

  const finalizeProposal = useCallback(
    async (proposalId: number) => {
      setIsSubmitting(true);
      try {
        await finalizeProposalRequest(proposalId);
        showSuccessToast("Proposal finalized");
        await fetchProposals();
      } catch (err) {
        handleError(err, "Failed to finalize proposal");
      } finally {
        setIsSubmitting(false);
      }
    },
    [fetchProposals],
  );

  const executeProposal = useCallback(
    async (proposalId: number) => {
      setIsSubmitting(true);
      try {
        await executeProposalRequest(proposalId);
        showSuccessToast("Proposal executed");
        await fetchProposals();
      } catch (err) {
        handleError(err, "Failed to execute proposal");
      } finally {
        setIsSubmitting(false);
      }
    },
    [fetchProposals],
  );

  return {
    proposals,
    isLoading,
    isSubmitting,
    stakedBalance,
    error,
    fetchProposals,
    createProposal,
    castVote,
    finalizeProposal,
    executeProposal,
  };
}