/**
 * StatusTracker Component - Usage Examples
 * 
 * This file demonstrates how to use the StatusTracker component
 * in different scenarios throughout the NGN-to-staking flow.
 */

import { StatusTracker, type StakingPosition } from "./StatusTracker";

// Example 1: Deposit Pending
export function ExampleDepositPending() {
  return (
    <StatusTracker
      status="deposit_pending"
      transactionId="txn_abc123"
    />
  );
}

// Example 2: Conversion Pending
export function ExampleConversionPending() {
  return (
    <StatusTracker
      status="conversion_pending"
      transactionId="txn_abc123"
    />
  );
}

// Example 3: Staking Queued
export function ExampleStakingQueued() {
  return (
    <StatusTracker
      status="staking_queued"
      transactionId="txn_abc123"
    />
  );
}

// Example 4: Confirmed (with maturity date)
export function ExampleConfirmedWithMaturity() {
  const position: StakingPosition = {
    amount: 1000.5,
    startDate: "2024-01-15T10:30:00Z",
    expectedYield: 12.5,
    maturityDate: "2025-01-15T10:30:00Z",
  };

  return (
    <StatusTracker
      status="confirmed"
      transactionId="txn_abc123"
      stakingPosition={position}
    />
  );
}

// Example 5: Confirmed (without maturity date)
export function ExampleConfirmedWithoutMaturity() {
  const position: StakingPosition = {
    amount: 5000.123456,
    startDate: "2024-01-15T10:30:00Z",
    expectedYield: 8.75,
  };

  return (
    <StatusTracker
      status="confirmed"
      transactionId="txn_abc123"
      stakingPosition={position}
    />
  );
}

// Example 6: Dynamic status based on polling
export function ExampleDynamicStatus() {
  // In a real implementation, this would come from polling
  const currentStatus = "conversion_pending"; // This would be dynamic
  const transactionId = "txn_abc123";
  const stakingPosition: StakingPosition | undefined = undefined; // Set when confirmed

  return (
    <StatusTracker
      status={currentStatus}
      transactionId={transactionId}
      stakingPosition={stakingPosition}
    />
  );
}

/**
 * Integration Example: Using StatusTracker in NgnStakingFlow
 * 
 * This shows how the StatusTracker would be integrated into the main flow:
 */
export function IntegrationExample() {
  // These would come from your state management
  const flowStage = "status_tracking"; // or "deposit_pending", etc.
  const transactionStatus = "conversion_pending";
  const transactionId = "txn_abc123";
  const stakingPosition: StakingPosition | undefined = undefined;

  // Only render StatusTracker when in appropriate stages
  if (flowStage === "status_tracking") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Transaction Status</h2>
        <StatusTracker
          status={transactionStatus}
          transactionId={transactionId}
          stakingPosition={stakingPosition}
        />
      </div>
    );
  }

  return null;
}
