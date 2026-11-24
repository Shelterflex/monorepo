"use client";

import { useMemo, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DISPUTE_REASON_LABELS,
  descriptionCharsRemaining,
  validateDescription,
  validateEvidenceFiles,
  type DisputeReason,
} from "@/lib/disputeTimeline";
import { createDispute, type PaymentHistoryItem } from "@/lib/tenantApi";
import { showErrorToast, showSuccessToast } from "@/lib/toast";

interface DisputeDialogProps {
  payment: PaymentHistoryItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFiled: () => void;
}

export function DisputeDialog({
  payment,
  open,
  onOpenChange,
  onFiled,
}: DisputeDialogProps) {
  const [reason, setReason] = useState<DisputeReason | "">("");
  const [description, setDescription] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  const charsRemaining = useMemo(
    () => descriptionCharsRemaining(description),
    [description],
  );

  const reset = () => {
    setReason("");
    setDescription("");
    setEvidenceFiles([]);
    setDescriptionError(null);
    setEvidenceError(null);
  };

  const handleFileChange = (files: FileList | null) => {
    const next = Array.from(files ?? []);
    const result = validateEvidenceFiles(next);
    if (!result.valid) {
      setEvidenceError(result.error ?? "Invalid evidence file.");
      return;
    }
    setEvidenceError(null);
    setEvidenceFiles(next);
  };

  const handleSubmit = async () => {
    if (!reason) {
      showErrorToast("Please select a reason for your dispute.");
      return;
    }
    const descResult = validateDescription(description);
    if (!descResult.valid) {
      setDescriptionError(descResult.error ?? "Invalid description.");
      return;
    }
    setDescriptionError(null);

    setIsSubmitting(true);
    try {
      await createDispute({
        paymentId: payment.id,
        dealId: payment.dealId,
        reason,
        description: description.trim(),
        evidenceKeys: evidenceFiles.map((file) => file.name),
      });
      showSuccessToast("Dispute filed. A rent release may be paused pending review.");
      reset();
      onOpenChange(false);
      onFiled();
    } catch (error: any) {
      showErrorToast(error?.message || "Failed to file dispute.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            File a dispute against this payment. A pending on-chain rent release
            may be paused while it is under review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dispute-reason" className="text-sm font-bold">
              Reason
            </Label>
            <Select value={reason} onValueChange={(value) => setReason(value as DisputeReason)}>
              <SelectTrigger id="dispute-reason" className="w-full">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DISPUTE_REASON_LABELS) as DisputeReason[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {DISPUTE_REASON_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="dispute-description" className="text-sm font-bold">
                Description
              </Label>
              <span className="text-xs text-muted-foreground">
                {charsRemaining} characters left
              </span>
            </div>
            <Textarea
              id="dispute-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                if (descriptionError) setDescriptionError(null);
              }}
              placeholder="Describe what went wrong with this charge..."
              aria-invalid={descriptionError ? true : undefined}
              aria-describedby={descriptionError ? "dispute-description-error" : undefined}
            />
            {descriptionError ? (
              <p id="dispute-description-error" role="alert" className="text-sm text-destructive">
                {descriptionError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="dispute-evidence" className="text-sm font-bold">
              Evidence
            </Label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-foreground/20 bg-muted px-3 py-2 text-sm hover:bg-muted/70">
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span>Upload evidence (up to 5 files)</span>
              <input
                id="dispute-evidence"
                type="file"
                multiple
                className="sr-only"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                aria-describedby={evidenceError ? "dispute-evidence-error" : undefined}
                onChange={(event) => handleFileChange(event.target.files)}
              />
            </label>
            {evidenceFiles.length > 0 ? (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {evidenceFiles.map((file) => (
                  <li key={file.name}>{file.name}</li>
                ))}
              </ul>
            ) : null}
            {evidenceError ? (
              <p id="dispute-evidence-error" role="alert" className="text-sm text-destructive">
                {evidenceError}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="border-2 border-foreground bg-background text-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="border-2 border-foreground bg-foreground text-background hover:bg-muted"
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            File Dispute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}