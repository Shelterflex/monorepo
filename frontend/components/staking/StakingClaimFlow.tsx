"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Copy,
  ExternalLink,
} from "lucide-react";

interface StakingClaimFlowProps {
  isOpen: boolean;
  onClose: () => void;
  rewardAmount?: number;
}

type ClaimStep = "breakdown" | "confirm" | "processing" | "success" | "failed";

interface TransactionStatus {
  hash?: string;
  status: "pending" | "confirmed" | "failed";
  timestamp?: Date;
}

export function StakingClaimFlow({
  isOpen,
  onClose,
  rewardAmount = 2500000,
}: StakingClaimFlowProps) {
  const [step, setStep] = useState<ClaimStep>("breakdown");
  const [transaction, setTransaction] = useState<TransactionStatus>({
    status: "pending",
  });
  const [copied, setCopied] = useState(false);

  const gasEstimate = 50000;
  const netAmount = rewardAmount - gasEstimate;

  const handleClaim = async () => {
    setStep("processing");
    setTransaction({ status: "pending", timestamp: new Date() });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const txHash = "0x" + Math.random().toString(16).slice(2, 66);
    setTransaction({
      hash: txHash,
      status: "confirmed",
      timestamp: new Date(),
    });

    setTimeout(() => {
      setStep("success");
    }, 1500);
  };

  const copyHash = () => {
    if (transaction.hash) {
      navigator.clipboard.writeText(transaction.hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setStep("breakdown");
    setTransaction({ status: "pending" });
    onClose();
  };

  const formatNgn = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Claim Staking Rewards</DialogTitle>
          <DialogDescription>
            Withdraw your accumulated staking rewards
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {step === "breakdown" && (
            <>
              <div className="border-3 border-foreground bg-muted p-6 space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Rewards Amount</span>
                    <span className="font-mono font-bold">
                      {formatNgn(rewardAmount)}
                    </span>
                  </div>
                  <div className="h-px bg-foreground" />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">
                      Gas Fee
                    </span>
                    <span className="text-sm font-mono">
                      {formatNgn(gasEstimate)}
                    </span>
                  </div>
                  <div className="h-px bg-foreground/30" />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-bold">You Receive</span>
                    <span className="font-mono text-lg font-bold text-primary">
                      {formatNgn(netAmount)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  • Gas fee will be deducted from your reward at claim time
                </p>
                <p>
                  • Claim will be processed on the blockchain immediately
                </p>
                <p>• You can check transaction status after claiming</p>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={handleClose}
                  className="border-2 border-foreground"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => setStep("confirm")}
                  className="border-3 border-foreground bg-primary font-bold"
                >
                  Proceed
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "confirm" && (
            <>
              <div className="border-3 border-warning bg-yellow-50 border-yellow-200 p-4">
                <p className="text-sm font-mono font-bold">
                  Confirm Claim Details
                </p>
                <div className="mt-3 space-y-2 text-sm">
                  <p>
                    Reward Amount:{" "}
                    <span className="font-bold">{formatNgn(rewardAmount)}</span>
                  </p>
                  <p>
                    Gas Fee:{" "}
                    <span className="font-bold">{formatNgn(gasEstimate)}</span>
                  </p>
                  <p>
                    Net Amount:{" "}
                    <span className="font-bold text-primary">
                      {formatNgn(netAmount)}
                    </span>
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm">
                  I acknowledge that I am claiming my staking rewards and
                  authorize the transaction.
                </p>
                <div className="text-xs text-muted-foreground">
                  By clicking "Claim", you authorize the transfer of your
                  rewards to your wallet address.
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep("breakdown")}
                  className="border-2 border-foreground"
                >
                  Back
                </Button>
                <Button
                  onClick={handleClaim}
                  className="border-3 border-foreground bg-primary font-bold"
                >
                  Confirm Claim
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "processing" && (
            <>
              <div className="flex flex-col items-center justify-center py-8">
                <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
                <h3 className="font-mono font-bold mb-2">Processing</h3>
                <p className="text-sm text-muted-foreground text-center">
                  Your claim is being processed on the blockchain
                </p>
                {transaction.hash && (
                  <div className="mt-4 w-full bg-muted p-3 rounded border-2 border-foreground text-xs font-mono break-all">
                    {transaction.hash}
                  </div>
                )}
              </div>
            </>
          )}

          {step === "success" && (
            <>
              <div className="flex flex-col items-center justify-center py-8">
                <CheckCircle2 className="h-16 w-16 text-primary mb-4" />
                <h3 className="font-mono text-xl font-bold mb-2">
                  Claim Confirmed
                </h3>
                <p className="text-center text-muted-foreground mb-4">
                  Your staking rewards have been successfully claimed
                </p>

                {transaction.hash && (
                  <div className="w-full space-y-3">
                    <div className="bg-muted p-3 rounded border-2 border-foreground">
                      <p className="text-xs text-muted-foreground mb-1">
                        Transaction Hash
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono break-all flex-1">
                          {transaction.hash.slice(0, 20)}...
                          {transaction.hash.slice(-20)}
                        </code>
                        <button
                          onClick={copyHash}
                          className="p-1 hover:bg-background rounded"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                      {copied && (
                        <p className="text-xs text-primary mt-1">Copied!</p>
                      )}
                    </div>

                    <div className="space-y-1 text-sm">
                      <p>
                        <strong>Status:</strong>{" "}
                        <span className="text-primary">Confirmed</span>
                      </p>
                      <p>
                        <strong>Amount:</strong> {formatNgn(netAmount)}
                      </p>
                      <p>
                        <strong>Time:</strong>{" "}
                        {transaction.timestamp?.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  onClick={handleClose}
                  className="w-full border-3 border-foreground bg-primary font-bold py-6"
                >
                  Done
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "failed" && (
            <>
              <div className="flex flex-col items-center justify-center py-8">
                <AlertCircle className="h-16 w-16 text-destructive mb-4" />
                <h3 className="font-mono text-xl font-bold mb-2">
                  Claim Failed
                </h3>
                <p className="text-center text-muted-foreground mb-4">
                  Your claim could not be processed. Please try again later.
                </p>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep("breakdown")}
                  className="border-2 border-foreground flex-1"
                >
                  Try Again
                </Button>
                <Button
                  onClick={handleClose}
                  className="border-3 border-foreground bg-primary font-bold flex-1"
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
