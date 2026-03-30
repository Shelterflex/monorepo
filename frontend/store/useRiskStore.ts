import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { logger } from "./logger";
import { getRiskState } from "@/lib/risk";

interface RiskState {
  isFrozen: boolean;
  freezeReason: string | null;
  deficitNgn: number;
  updatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setRiskState: (state: Partial<RiskState>) => void;
  fetchRiskState: () => Promise<void>;
  reset: () => void;
}

const useRiskStore = create<RiskState>()(
  logger(
    persist(
      (set) => ({
        isFrozen: false,
        freezeReason: null,
        deficitNgn: 0,
        updatedAt: null,
        isLoading: false,
        error: null,
        
        setRiskState: (state) => set((prev) => ({ ...prev, ...state })),
        
        fetchRiskState: async () => {
          set({ isLoading: true, error: null });
          try {
            const risk = await getRiskState();
            set({
              isFrozen: risk.isFrozen,
              freezeReason: risk.freezeReason ?? null,
              deficitNgn: risk.deficitNgn,
              updatedAt: risk.updatedAt,
              isLoading: false,
            });
          } catch (err) {
            set({ 
              isLoading: false, 
              error: err instanceof Error ? err.message : "Failed to fetch risk state" 
            });
          }
        },
        
        reset: () => set({
          isFrozen: false,
          freezeReason: null,
          deficitNgn: 0,
          updatedAt: null,
          isLoading: false,
          error: null,
        }),
      }),
      {
        name: "sheltaflex-risk-storage",
        storage: createJSONStorage(() => localStorage),
        version: 1,
      }
    ),
    "RiskStore"
  )
);

export default useRiskStore;
