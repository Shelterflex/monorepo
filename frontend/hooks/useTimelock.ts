import { useState, useEffect, useCallback } from "react";
import { getQueuedTransactions, executeTransaction, cancelTransaction, type QueuedTransaction } from "@/lib/timelockApi";
import { handleError, showSuccessToast } from "@/lib/toast";

export function useTimelock() {
  const [queuedTransactions, setQueuedTransactions] = useState<QueuedTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    try {
      const txs = await getQueuedTransactions();
      setQueuedTransactions(txs);
    } catch (err) {
      handleError(err, "Failed to fetch queued transactions");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions();
    // Poll every 10 seconds for updates
    const interval = setInterval(fetchTransactions, 10000);
    return () => clearInterval(interval);
  }, [fetchTransactions]);

  const handleExecute = async (id: string) => {
    try {
      const res = await executeTransaction(id);
      if (res.success) {
        showSuccessToast("Transaction executed successfully");
        await fetchTransactions();
      }
    } catch (err) {
      handleError(err, "Failed to execute transaction");
    }
  };

  const handleCancel = async (id: string) => {
    try {
      const res = await cancelTransaction(id);
      if (res.success) {
        showSuccessToast("Transaction cancelled successfully");
        await fetchTransactions();
      }
    } catch (err) {
      handleError(err, "Failed to cancel transaction");
    }
  };

  return {
    queuedTransactions,
    isLoading,
    fetchTransactions,
    handleExecute,
    handleCancel,
  };
}

export function useCountdown(eta: number) {
  const [timeLeft, setTimeLeft] = useState(() => Math.max(0, eta - Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(Math.max(0, eta - Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [eta]);

  const formatTime = () => {
    if (timeLeft <= 0) return "Ready to Execute";
    const hours = Math.floor(timeLeft / 3600);
    const minutes = Math.floor((timeLeft % 3600) / 60);
    const seconds = timeLeft % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
  };

  return { timeLeft, formatTime };
}
