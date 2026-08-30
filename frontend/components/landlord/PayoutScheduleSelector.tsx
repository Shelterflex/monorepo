"use client";

import { useState } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export type PayoutSchedule = "activation" | "weekly" | "monthly";

const SCHEDULE_LABELS: Record<PayoutSchedule, string> = {
  activation: "On Deal Activation",
  weekly: "Weekly",
  monthly: "Monthly",
};

interface PayoutScheduleSelectorProps {
  initialSchedule?: PayoutSchedule;
}

export function PayoutScheduleSelector({
  initialSchedule = "monthly",
}: PayoutScheduleSelectorProps) {
  const [schedule, setSchedule] = useState<PayoutSchedule>(initialSchedule);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingValue, setPendingValue] = useState<PayoutSchedule | null>(null);
  const confirmDialogRef = useFocusTrap(!!pendingValue, () => setPendingValue(null));

  const handleScheduleChange = async (value: string) => {
    const newSchedule = value as PayoutSchedule;
    if (newSchedule === schedule) return;
    setPendingValue(newSchedule);
  };

  const confirmChange = async () => {
    if (!pendingValue) return;
    const newSchedule = pendingValue;
    setPendingValue(null);
    setSchedule(newSchedule);
    setIsSaving(true);

    try {
      const response = await fetch("/api/landlord/payout/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule: newSchedule }),
      });

      if (!response.ok) throw new Error("Failed to update preferences");
      toast.success(`Payout schedule changed to ${SCHEDULE_LABELS[newSchedule]}`);
    } catch {
      toast.error("Failed to update payout schedule. Please try again.");
      setSchedule(initialSchedule);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Payout Schedule
          </h3>
          <p className="text-sm text-muted-foreground">
            Choose when you want to receive your payouts.
          </p>
        </div>
        {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Saving" />}
      </div>

      <RadioGroup.Root
        className="flex flex-col space-y-3"
        value={schedule}
        onValueChange={handleScheduleChange}
        disabled={isSaving}
        aria-label="Payout schedule frequency"
      >
        {(["activation", "weekly", "monthly"] as PayoutSchedule[]).map((option) => (
          <div key={option} className="flex items-center space-x-2">
            <RadioGroup.Item
              value={option}
              id={option}
              className="peer h-4 w-4 rounded-full border border-primary text-primary shadow focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary"
            >
              <RadioGroup.Indicator className="flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-primary-foreground" />
              </RadioGroup.Indicator>
            </RadioGroup.Item>
            <label
              htmlFor={option}
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {SCHEDULE_LABELS[option]}
            </label>
          </div>
        ))}
      </RadioGroup.Root>

      {/* Confirmation Dialog */}
      {pendingValue && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm schedule change"
          onClick={(e) => { if (e.target === e.currentTarget) setPendingValue(null); }}
        >
          <div
            ref={confirmDialogRef}
            tabIndex={-1}
            className="w-full max-w-sm rounded-lg border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:outline-none"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden="true" />
              <h4 className="text-lg font-bold">Change payout schedule?</h4>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              This will change your payout frequency from{" "}
              <strong>{SCHEDULE_LABELS[schedule]}</strong> to{" "}
              <strong>{SCHEDULE_LABELS[pendingValue]}</strong>.
              Changes take effect for upcoming payouts.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setPendingValue(null)}
                className="border-2 border-foreground font-bold"
              >
                Cancel
              </Button>
              <Button
                onClick={confirmChange}
                className="border-2 border-foreground font-bold"
              >
                Confirm change
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
