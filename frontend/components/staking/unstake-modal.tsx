"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Clock, Info, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface UnstakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (amount: string) => Promise<void>;
  maxAmount: string;
  warmingAmount: string;
  coolingPeriodDays?: number;
}

export function UnstakeModal({
  isOpen,
  onClose,
  onConfirm,
  maxAmount,
  warmingAmount,
  coolingPeriodDays = 7,
}: UnstakeModalProps) {
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!amount || Number(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (Number(amount) > Number(maxAmount)) {
      setError(`Maximum unstakeable amount is ${maxAmount} USDC`);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm(amount);
      setAmount("");
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to unstake tokens");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md border-3 border-foreground bg-card p-0 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
        <DialogHeader className="border-b-3 border-foreground p-6 bg-accent/10">
          <DialogTitle className="text-2xl font-bold">Unstake Tokens</DialogTitle>
          <DialogDescription className="text-foreground/70 font-medium">
            Withdraw your USDC from the staking pool.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-6">
          {/* Info Section */}
          <div className="border-3 border-foreground bg-accent/5 p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-bold">Cooling Period: {coolingPeriodDays} Days</p>
                <p className="text-xs text-muted-foreground">
                  Once you unstake, your tokens will enter a cooling period before they can be withdrawn to your wallet.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="unstake-amount" className="font-bold">Amount to Unstake</Label>
                <span className="text-xs font-bold text-muted-foreground">
                  Max: {maxAmount} USDC
                </span>
              </div>
              <div className="relative">
                <Input
                  id="unstake-amount"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="border-3 border-foreground bg-background py-6 text-lg font-mono font-bold shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                  disabled={isSubmitting}
                />
                <button
                  onClick={() => setAmount(maxAmount)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded border-2 border-foreground bg-primary px-2 py-0.5 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                >
                  MAX
                </button>
              </div>
            </div>

            {Number(warmingAmount) > 0 && (
              <div className="flex items-start gap-2 rounded-md border-2 border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p>
                  <strong>Note:</strong> You have {warmingAmount} USDC currently warming up. 
                  Unstaking now will prioritize active stake first.
                </p>
              </div>
            )}

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-md border-2 border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-3 border-t-3 border-foreground p-6 bg-muted/30">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 border-3 border-foreground bg-background font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:bg-muted"
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            className="flex-1 border-3 border-foreground bg-destructive text-destructive-foreground font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
            disabled={isSubmitting || !amount || Number(amount) <= 0}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirming...
              </>
            ) : (
              "Confirm Unstake"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
