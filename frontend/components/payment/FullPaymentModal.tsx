"use client";

import { useState, useCallback } from "react";
import { Loader2, AlertCircle, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PayoutBreakdown } from "./PayoutBreakdown";
import {
  getFullPaymentPreview,
  confirmFullPayment,
  type FullPaymentPreview,
  type FullPaymentReceipt,
} from "@/lib/paymentApi";
import { handleError } from "@/lib/toast";
import { useTranslations } from "next-intl";

interface FullPaymentModalProps {
  paymentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (receipt: FullPaymentReceipt) => void;
}

type Step = "loading" | "preview" | "confirming" | "receipt" | "error";

export function FullPaymentModal({
  paymentId,
  open,
  onOpenChange,
  onSuccess,
}: FullPaymentModalProps) {
  const t = useTranslations("payment");
  const commonT = useTranslations("common");
  const [step, setStep] = useState<Step>("loading");
  const [preview, setPreview] = useState<FullPaymentPreview | null>(null);
  const [receipt, setReceipt] = useState<FullPaymentReceipt | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const reset = useCallback(() => {
    setStep("loading");
    setPreview(null);
    setReceipt(null);
    setErrorMsg("");
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset]
  );

  // Load preview when dialog opens
  const handleOpen = useCallback(async () => {
    setStep("loading");
    try {
      const data = await getFullPaymentPreview(paymentId);
      setPreview(data);
      setStep("preview");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("somethingWentWrong"));
      setStep("error");
      handleError(err);
    }
  }, [paymentId, t]);

  const handleConfirm = async () => {
    if (!preview) return;
    setStep("confirming");
    try {
      const data = await confirmFullPayment(paymentId);
      setReceipt(data);
      setStep("receipt");
      onSuccess?.(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("somethingWentWrong"));
      setStep("error");
      handleError(err);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      // Load preview as soon as the dialog opens
      {...(open && step === "loading" ? { ref: () => handleOpen() } : {})}
    >
      <DialogContent
        className="border-3 border-foreground shadow-[8px_8px_0px_0px_rgba(26,26,26,1)] sm:max-w-md"
        onOpenAutoFocus={() => {
          if (step === "loading") handleOpen();
        }}
      >
        {/* Loading */}
        {step === "loading" && (
          <div role="status" className="flex flex-col items-center gap-4 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t("loadingDetails")}</p>
          </div>
        )}

        {/* Preview */}
        {(step === "preview" || step === "confirming") && preview && (
          <>
            <DialogHeader>
              <DialogTitle className="font-bold">{t("fullPayment")}</DialogTitle>
              <DialogDescription>
                {t("reviewDistribution")}
              </DialogDescription>
            </DialogHeader>

            <PayoutBreakdown breakdown={preview.breakdown} className="mt-2" />

            <div className="mt-4 flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-2 border-foreground font-bold"
                onClick={() => handleOpenChange(false)}
                disabled={step === "confirming"}
              >
                {commonT("cancel")}
              </Button>
              <Button
                className="flex-1 border-2 border-foreground font-bold shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)]"
                onClick={handleConfirm}
                disabled={step === "confirming"}
              >
                {step === "confirming" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("processing")}
                  </>
                ) : (
                  t("confirmPayment")
                )}
              </Button>
            </div>
          </>
        )}

        {/* Receipt */}
        {step === "receipt" && receipt && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-secondary-foreground" />
                <DialogTitle className="font-bold">{t("receipt")}</DialogTitle>
              </div>
              <DialogDescription>
                {t("reference")}:{" "}
                <span className="font-mono font-bold text-foreground">{receipt.reference}</span>
              </DialogDescription>
            </DialogHeader>

            <PayoutBreakdown breakdown={receipt.breakdown} confirmed className="mt-2" />

            <p className="mt-3 text-center text-xs text-muted-foreground">
              Paid on{" "}
              {new Intl.DateTimeFormat("en-NG", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Africa/Lagos",
              }).format(new Date(receipt.paidAt))}
            </p>

            <Button
              className="mt-4 w-full border-2 border-foreground font-bold"
              onClick={() => handleOpenChange(false)}
            >
              {commonT("close")}
            </Button>
          </>
        )}

        {/* Error */}
        {step === "error" && (
          <>
            <DialogHeader>
              <DialogTitle className="font-bold">{t("somethingWentWrong")}</DialogTitle>
            </DialogHeader>
            <div className="flex items-start gap-3 border-2 border-destructive/30 bg-destructive/10 p-4">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p role="alert" className="text-sm text-destructive">{errorMsg}</p>
            </div>
            <div className="mt-4 flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-2 border-foreground font-bold"
                onClick={() => handleOpenChange(false)}
              >
                {commonT("close")}
              </Button>
              <Button
                className="flex-1 border-2 border-foreground font-bold"
                onClick={handleOpen}
              >
                {t("tryAgain")}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
