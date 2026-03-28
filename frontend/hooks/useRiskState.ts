"use client";

import { useEffect } from "react";
import useRiskStore from "@/store/useRiskStore";

interface UseRiskStateResult {
  isFrozen: boolean;
  freezeReason: string | null;
  deficitNgn: number;
  updatedAt: string | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useRiskState(): UseRiskStateResult {
  const { 
    isFrozen, 
    freezeReason, 
    deficitNgn, 
    updatedAt, 
    isLoading, 
    fetchRiskState 
  } = useRiskStore();

  useEffect(() => {
    // Only fetch if we don't have data yet or if we want to refresh on mount
    fetchRiskState();
  }, [fetchRiskState]);

  return { 
    isFrozen, 
    freezeReason, 
    deficitNgn, 
    updatedAt, 
    isLoading, 
    refresh: fetchRiskState 
  };
}
