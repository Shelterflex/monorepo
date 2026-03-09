"use client";

import { useCallback, useEffect, useState } from "react";
import { getRiskState } from "@/lib/risk";

interface UseRiskStateResult {
  isFrozen: boolean;
  freezeReason: string | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useRiskState(): UseRiskStateResult {
  const [isFrozen, setIsFrozen] = useState(false);
  const [freezeReason, setFreezeReason] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const risk = await getRiskState();
    setIsFrozen(risk.isFrozen);
    setFreezeReason(risk.freezeReason ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchRiskState() {
      try {
        const risk = await getRiskState();
        if (!cancelled) {
          setIsFrozen(risk.isFrozen);
          setFreezeReason(risk.freezeReason ?? null);
        }
      } catch (error) {
        console.error("Failed to fetch risk state", error);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchRiskState();

    return () => {
      cancelled = true;
    };
  }, []);

  return { isFrozen, freezeReason, isLoading, refresh };
}
