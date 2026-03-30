import { apiFetch } from "./api";

export interface QueuedTransaction {
  txHash: string;
  target: string;
  functionName: string;
  args: any[];
  eta: number; // Unix timestamp
  status: 'queued' | 'executed' | 'cancelled';
  ledger: number;
  createdAt: string;
  updatedAt: string;
}

export interface TimelockStatusResponse {
  transactions: QueuedTransaction[];
}

export async function getQueuedTransactions(): Promise<QueuedTransaction[]> {
  try {
    const response = await apiFetch<TimelockStatusResponse>("/api/admin/timelock/transactions");
    // The backend returns { transactions: [...] }
    return response.transactions || [];
  } catch (error) {
    console.error("Timelock API error:", error);
    throw error;
  }
}

export async function executeTransaction(txHash: string): Promise<{ success: boolean; stellarTxHash?: string; error?: string }> {
  try {
    const response = await apiFetch<{ success: boolean; stellarTxHash?: string; error?: string }>("/api/admin/timelock/execute", {
      method: "POST",
      body: JSON.stringify({ txHash }),
    });
    return response;
  } catch (error) {
    console.error("Timelock Execution error:", error);
    throw error;
  }
}

export async function cancelTransaction(txHash: string): Promise<{ success: boolean; stellarTxHash?: string; error?: string }> {
  try {
    const response = await apiFetch<{ success: boolean; stellarTxHash?: string; error?: string }>("/api/admin/timelock/cancel", {
      method: "POST",
      body: JSON.stringify({ txHash }),
    });
    return response;
  } catch (error) {
    console.error("Timelock Cancellation error:", error);
    throw error;
  }
}
