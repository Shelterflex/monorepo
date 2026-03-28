"use client";

import { useState, useCallback } from "react";
import { ArrowRight, AlertCircle, Check, Loader2, AlertTriangle } from "lucide-react";
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
  initiateWithdrawal,
  type WithdrawalResponse,
  type BankAccountDetails,
} from "@/lib/walletApi";
import { ACCOUNT_FROZEN_MESSAGE, isAccountFrozenError } from "@/lib/api";

interface WithdrawalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  availableBalance: number;
  isFrozen?: boolean;
  freezeReason?: string | null;
  deficitNgn?: number;
  onTopUpClick?: () => void;
}

type Step = "input" | "confirmation" | "error";

const MIN_WITHDRAWAL = 100;
const MAX_WITHDRAWAL = 1000000;

const NIGERIAN_BANKS = [
  "Access Bank",
  "Citibank Nigeria",
  "Ecobank Nigeria",
  "Fidelity Bank",
  "First Bank of Nigeria",
  "First City Monument Bank (FCMB)",
  "Guaranty Trust Bank (GTBank)",
  "Heritage Bank",
  "Keystone Bank",
  "Polaris Bank",
  "Stanbic IBTC Bank",
  "Standard Chartered Bank",
  "Sterling Bank",
  "Union Bank of Nigeria",
  "United Bank for Africa (UBA)",
  "Wema Bank",
  "Zenith Bank",
];

function formatNgn(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount);
}

export function WithdrawalModal({
  open,
  onOpenChange,
  onSuccess,
  availableBalance,
  isFrozen = false,
  freezeReason,
  deficitNgn = 0,
  onTopUpClick,
}: WithdrawalModalProps) {
  const [step, setStep] = useState<Step>("input");
  const [amount, setAmount] = useState<string>("");
  const [accountNumber, setAccountNumber] = useState<string>("");
  const [accountName, setAccountName] = useState<string>("");
  const [bankName, setBankName] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [withdrawalResult, setWithdrawalResult] = useState<WithdrawalResponse | null>(null);

  const reset = useCallback(() => {
    setStep("input");
    setAmount("");
    setAccountNumber("");
    setAccountName("");
    setBankName("");
    setIsSubmitting(false);
    setErrorMessage("");
    setWithdrawalResult(null);
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
    if (num < MIN_WITHDRAWAL) {
      return `Minimum withdrawal is ${formatNgn(MIN_WITHDRAWAL)}`;
    }
    if (num > MAX_WITHDRAWAL) {
      return `Maximum withdrawal is ${formatNgn(MAX_WITHDRAWAL)}`;
    }
    if (num > availableBalance) {
      return `Insufficient balance. Available: ${formatNgn(availableBalance)}`;
    }
    return null;
  };

  const validateBankDetails = (): string | null => {
    if (!accountNumber || accountNumber.length !== 10) {
      return "Please enter a valid 10-digit account number";
    }
    if (!accountName || accountName.trim().length < 3) {
      return "Please enter a valid account name";
    }
    if (!bankName) {
      return "Please select a bank";
    }
    return null;
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    if (isFrozen) {
      setErrorMessage(ACCOUNT_FROZEN_MESSAGE);
      setStep("error");
      return;
    }

    const validationError = validateAmount(amount);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const bankValidationError = validateBankDetails();
    if (bankValidationError) {
      setErrorMessage(bankValidationError);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const bankAccount: BankAccountDetails = {
        accountNumber,
        accountName: accountName.trim(),
        bankName,
      };

      const result = await initiateWithdrawal({
        amountNgn: Number(amount),
        bankAccount,
      });
      setWithdrawalResult(result);
      setStep("confirmation");
      showSuccessToast("Withdrawal initiated successfully");
      onSuccess?.();
    } catch (err) {
      handleError(err, "Failed to initiate withdrawal");
      const message = isAccountFrozenError(err)
        ? ACCOUNT_FROZEN_MESSAGE
        : err instanceof Error ? err.message : "Failed to initiate withdrawal";
      setErrorMessage(message);
      setStep("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const withdrawalStatusPresentation = (status: WithdrawalResponse["status"]) => {
    switch (status) {
      case "pending":
        return { label: "Pending", variant: "outline" as const };
      case "approved":
        return { label: "Approved", variant: "secondary" as const };
      case "rejected":
        return { label: "Rejected", variant: "destructive" as const };
      case "confirmed":
        return { label: "Confirmed", variant: "default" as const };
      case "failed":
        return { label: "Failed", variant: "destructive" as const };
      default:
        return { label: "Unknown", variant: "outline" as const };
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="border-3 border-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {step === "input" && "Withdraw Funds"}
            {step === "confirmation" && "Withdrawal Initiated"}
            {step === "error" && "Withdrawal Failed"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {step === "input" && "Withdraw NGN to your bank account."}
            {step === "confirmation" && "Your withdrawal request has been submitted."}
            {step === "error" && "We couldn't process your withdrawal request."}
          </DialogDescription>
        </DialogHeader>

        {step === "input" && (
          <div className="space-y-5 pt-2">
            {isFrozen && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <p className="font-semibold">Account frozen</p>
                <p className="mt-1">{ACCOUNT_FROZEN_MESSAGE}</p>
                {deficitNgn > 0 && (
                  <p className="mt-1">Outstanding deficit: {formatNgn(deficitNgn)}</p>
                )}
                {freezeReason ? <p className="mt-1 text-xs">Reason: {freezeReason}</p> : null}
              </div>
            )}

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
                min={MIN_WITHDRAWAL}
                max={Math.min(MAX_WITHDRAWAL, availableBalance)}
                className="border-2 border-foreground"
                disabled={isSubmitting || isFrozen}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Min: {formatNgn(MIN_WITHDRAWAL)} · Max: {formatNgn(MAX_WITHDRAWAL)}</span>
                <span>Available: {formatNgn(availableBalance)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bankName">Bank</Label>
              <Select
                value={bankName}
                onValueChange={(value) => {
                  setBankName(value);
                  setErrorMessage("");
                }}
                disabled={isSubmitting || isFrozen}
              >
                <SelectTrigger id="bankName" className="border-2 border-foreground">
                  <SelectValue placeholder="Select your bank" />
                </SelectTrigger>
                <SelectContent>
                  {NIGERIAN_BANKS.map((bank) => (
                    <SelectItem key={bank} value={bank}>
                      {bank}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountNumber">Account Number</Label>
              <Input
                id="accountNumber"
                type="text"
                placeholder="Enter 10-digit account number"
                value={accountNumber}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setAccountNumber(value);
                  setErrorMessage("");
                }}
                maxLength={10}
                className="border-2 border-foreground"
                disabled={isSubmitting || isFrozen}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountName">Account Name</Label>
              <Input
                id="accountName"
                type="text"
                placeholder="Enter account name"
                value={accountName}
                onChange={(e) => {
                  setAccountName(e.target.value);
                  setErrorMessage("");
                }}
                className="border-2 border-foreground"
                disabled={isSubmitting || isFrozen}
              />
            </div>

            {errorMessage && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <span className="text-destructive">{errorMessage}</span>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={
                isFrozen ||
                isSubmitting ||
                !amount ||
                !accountNumber ||
                !accountName ||
                !bankName
              }
              className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Withdraw Funds
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        )}

        {step === "confirmation" && withdrawalResult && (
          <div className="space-y-5 pt-2">
            <div className="rounded-md border-2 border-foreground bg-muted p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Amount</span>
                <span className="font-mono font-bold">{formatNgn(withdrawalResult.amountNgn)}</span>
              </div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Bank</span>
                <span className="font-medium">{withdrawalResult.bankAccount.bankName}</span>
              </div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Account Number</span>
                <span className="font-mono">{withdrawalResult.bankAccount.accountNumber}</span>
              </div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Account Name</span>
                <span className="font-medium">{withdrawalResult.bankAccount.accountName}</span>
              </div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Reference</span>
                <span className="font-mono text-sm">{withdrawalResult.reference}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant={withdrawalStatusPresentation(withdrawalResult.status).variant}>
                  {withdrawalStatusPresentation(withdrawalResult.status).label}
                </Badge>
              </div>
            </div>

            <div className="rounded-md border-2 border-blue-200 bg-blue-50 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-blue-600" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium">Funds Held</p>
                  <p className="mt-1">
                    {formatNgn(withdrawalResult.amountNgn)} has been held from your available balance
                    while this withdrawal is being processed.
                  </p>
                </div>
              </div>
            </div>

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
                New Withdrawal
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
                <p className="font-bold">Could not process withdrawal</p>
                <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
                {errorMessage === ACCOUNT_FROZEN_MESSAGE && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Top up your wallet to repay the deficit, then try again.
                  </p>
                )}
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
                  if (errorMessage === ACCOUNT_FROZEN_MESSAGE && onTopUpClick) {
                    onTopUpClick();
                    return;
                  }
                  setStep("input");
                  setErrorMessage("");
                }}
                className="flex-1 border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                {errorMessage === ACCOUNT_FROZEN_MESSAGE && onTopUpClick
                  ? "Top Up Wallet"
                  : "Try Again"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
