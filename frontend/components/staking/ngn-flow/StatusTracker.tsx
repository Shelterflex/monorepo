import React from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

// Type definitions
export interface StakingPosition {
  amount: number; // USDC
  startDate: string; // ISO 8601
  expectedYield: number; // APY percentage
  maturityDate?: string;
}

export type TransactionStatus =
  | "deposit_pending"
  | "conversion_pending"
  | "staking_queued"
  | "confirmed";

export interface StatusTrackerProps {
  status: TransactionStatus;
  transactionId: string;
  stakingPosition?: StakingPosition;
}

// Sub-component: DepositPendingStatus
function DepositPendingStatus() {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-6">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <div>
          <p className="font-medium" role="status" aria-live="polite">
            Waiting for your deposit
          </p>
          <p className="text-sm text-muted-foreground">
            We'll proceed once your payment is confirmed
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Sub-component: ConversionPendingStatus
function ConversionPendingStatus() {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-6">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <div>
          <p className="font-medium" role="status" aria-live="polite">
            Converting NGN to USDC
          </p>
          <p className="text-sm text-muted-foreground">
            Your currency conversion is in progress
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Sub-component: StakingQueuedStatus
function StakingQueuedStatus() {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-6">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <div>
          <p className="font-medium" role="status" aria-live="polite">
            Staking queued — processing shortly
          </p>
          <p className="text-sm text-muted-foreground">
            Your USDC will be staked momentarily
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Sub-component: ConfirmedStatus
interface ConfirmedStatusProps {
  position: StakingPosition;
}

function ConfirmedStatus({ position }: ConfirmedStatusProps) {
  const formatDate = (isoDate: string) => {
    return new Date(isoDate).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatAmount = (amount: number) => {
    return amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  };

  return (
    <Card className="border-green-200 bg-green-50/50">
      <CardContent className="space-y-4 py-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-green-600" aria-hidden="true" />
          <div>
            <p className="font-semibold text-green-900" role="status" aria-live="polite">
              Staking Complete
            </p>
            <p className="text-sm text-green-700">
              Your position is now active
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-green-200 bg-white p-4">
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Staked Amount</span>
            <span className="font-medium">{formatAmount(position.amount)} USDC</span>
          </div>

          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Start Date</span>
            <span className="font-medium">{formatDate(position.startDate)}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Expected Yield (APY)</span>
            <span className="font-medium text-green-600">
              {position.expectedYield.toFixed(2)}%
            </span>
          </div>

          {position.maturityDate && (
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Maturity Date</span>
              <span className="font-medium">{formatDate(position.maturityDate)}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Main StatusTracker component
export function StatusTracker({
  status,
  transactionId,
  stakingPosition,
}: StatusTrackerProps) {
  // Route to appropriate sub-component based on status
  switch (status) {
    case "deposit_pending":
      return <DepositPendingStatus />;
    
    case "conversion_pending":
      return <ConversionPendingStatus />;
    
    case "staking_queued":
      return <StakingQueuedStatus />;
    
    case "confirmed":
      if (!stakingPosition) {
        console.error("StatusTracker: stakingPosition is required for confirmed status");
        return null;
      }
      return <ConfirmedStatus position={stakingPosition} />;
    
    default:
      console.error(`StatusTracker: Unknown status "${status}"`);
      return null;
  }
}
