"use client";

import { useState, useCallback } from "react";
import { Copy, ExternalLink, ArrowRight, AlertCircle, Check, Loader2 } from "lucide-react";
import { handleError, showSuccessToast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

import {
  initiateTopUp,
  type TopUpRail,
  type TopUpResponse,
} from "@/lib/walletApi";

interface TopUpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type Step = "input" | "confirmation" | "error";

const MIN_TOP_UP = 100; // Minimum 100 NGN
const MAX_TOP_UP = 1000000; // Maximum 1,000,000 NGN

const RAIL_OPTIONS: { value: TopUpRail; label: string }[] = [
  { value: "paystack", label: "Paystack (Card/Transfer)" },
  { value: "flutterwave", label: "Flutterwave" },
  { value: "bank_transfer", label: "Bank Transfer" },
];

function formatNgn(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount);
}

export function TopUpModal({ open, onOpenChange, onSuccess }: TopUpModalProps) {
  const [step, setStep] = useState<Step>("input");
  const [amount, setAmount] = useState<string>("");
  const [rail, setRail] = useState<TopUpRail | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [topUpResult, setTopUpResult] = useState<TopUpResponse | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("input");
    setAmount("");
    setRail("");
    setIsSubmitting(false);
    setErrorMessage("");
    setTopUpResult(null);
    setCopiedField(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [onOpenChange, reset]);

  const validateAmount = (value: string): string | null => {
    const num = Number(value);
    if (!value || isNaN(num) || num <= 0) {
      return "Please enter a valid amount";
    }
    if (num < MIN_TOP_UP) {
      return `Minimum top-up is ${formatNgn(MIN_TOP_UP)}`;
    }
    if (num > MAX_TOP_UP) {
      return `Maximum top-up is ${formatNgn(MAX_TOP_UP)}`;
    }
    return null;
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    const validationError = validateAmount(amount);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    if (!rail) {
      setErrorMessage("Please select a payment method");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const result = await initiateTopUp({
        amountNgn: Number(amount),
        rail,
      });
      setTopUpResult(result);
      setStep("confirmation");
      showSuccessToast("Top-up initiated successfully");
      onSuccess?.();
    } catch (err) {
      // Show toast for API errors
      handleError(err, "Failed to initiate top-up");
      // Also set inline error for form display
      const message = err instanceof Error ? err.message : "Failed to initiate top-up";
      setErrorMessage(message);
      setStep("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Silent fail - user can manually copy
    }
  };

  const handleRedirect = () => {
    if (topUpResult?.redirectUrl) {
      window.open(topUpResult.redirectUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="border-3 border-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {step === "input" && "Top Up Wallet"}
            {step === "confirmation" && "Confirm Your Deposit"}
            {step === "error" && "Top-Up Failed"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {step === "input" && "Add NGN to your wallet using your preferred payment method."}
            {step === "confirmation" && "Complete your payment to credit your wallet."}
            {step === "error" && "We couldn't process your top-up request."}
          </DialogDescription>
        </DialogHeader>

        {step === "input" && (
          <div className="space-y-5 pt-2">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (NGN)</Label>
              <Input
                id="amount"
                type="number"
                placeholder="Enter amount"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setErrorMessage("");
                }}
                min={MIN_TOP_UP}
                max={MAX_TOP_UP}
                className="border-2 border-foreground"
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Min: {formatNgn(MIN_TOP_UP)} · Max: {formatNgn(MAX_TOP_UP)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rail">Payment Method</Label>
              <Select
                value={rail}
                onValueChange={(value) => {
                  setRail(value as TopUpRail);
                  setErrorMessage("");
                }}
                disabled={isSubmitting}
              >
                <SelectTrigger id="rail" className="border-2 border-foreground">
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  {RAIL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {errorMessage && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <span className="text-destructive">{errorMessage}</span>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !amount || !rail}
              className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        )}

        {step === "confirmation" && topUpResult && (
          <div className="space-y-5 pt-2">
            <div className="rounded-md border-2 border-foreground bg-muted p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Amount</span>
                <span className="font-mono font-bold">{formatNgn(topUpResult.amountNgn)}</span>
              </div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Reference</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{topUpResult.reference}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 border-2 px-2"
                    onClick={() => handleCopy(topUpResult.reference, "reference")}
                  >
                    {copiedField === "reference" ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant="outline">Pending Confirmation</Badge>
              </div>
            </div>

            {/* Redirect rails */}
            {(topUpResult.rail === "paystack" || topUpResult.rail === "flutterwave") &&
              topUpResult.redirectUrl && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    You will be redirected to complete your payment securely.
                  </p>
                  <Button
                    onClick={handleRedirect}
                    className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Continue to Payment
                  </Button>
                </div>
              )}

            {/* Bank transfer rail */}
            {topUpResult.rail === "bank_transfer" && topUpResult.bankTransfer && (
              <div className="space-y-3">
                <p className="text-sm font-medium">Bank Transfer Instructions</p>
                <p className="text-xs text-muted-foreground">
                  Transfer the exact amount to the account below. Use the reference as the narration.
                </p>

                <div className="space-y-2 rounded-md border-2 border-foreground p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Bank</span>
                    <span className="font-medium">{topUpResult.bankTransfer.bankName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Account Number</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">
                        {topUpResult.bankTransfer.accountNumber}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 border-2 px-2"
                        onClick={() =>
                          handleCopy(topUpResult.bankTransfer!.accountNumber, "accountNumber")
                        }
                      >
                        {copiedField === "accountNumber" ? (
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Account Name</span>
                    <span className="font-medium">{topUpResult.bankTransfer.accountName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Reference (Narration)</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{topUpResult.reference}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 border-2 px-2"
                        onClick={() => handleCopy(topUpResult.reference, "narration")}
                      >
                        {copiedField === "narration" ? (
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                {topUpResult.expiresAt && (
                  <p className="text-xs text-muted-foreground">
                    Expires: {new Date(topUpResult.expiresAt).toLocaleString("en-NG")}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1 border-2 border-foreground font-bold"
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  reset();
                  setStep("input");
                }}
                className="flex-1 border-3 border-foreground bg-secondary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                New Top-Up
              </Button>
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="space-y-5 pt-2">
            <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-destructive/10">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <p className="font-bold">Could not process top-up</p>
                <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1 border-2 border-foreground font-bold"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setStep("input");
                  setErrorMessage("");
                }}
                className="flex-1 border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                Try Again
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
