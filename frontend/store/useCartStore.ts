import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { logger } from "./index";

export interface CartItem {
  id: string;
  type: "staking" | "deposit" | "conversion";
  label: string;
  amount: number;
  currency: string;
  meta?: Record<string, unknown>;
}

interface OptimisticOp {
  id: string;
  type: "add" | "remove" | "update";
  item: CartItem;
  previousState: CartItem[];
}

interface CartState {
  items: CartItem[];
  pendingOps: OptimisticOp[];

  // Actions
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, patch: Partial<CartItem>) => void;
  clear: () => void;

  // Optimistic update helpers
  rollbackOp: (opId: string) => void;
  confirmOp: (opId: string) => void;

  // Derived
  totalAmount: () => number;
}

const useCartStore = create<CartState>()(
  logger(
    persist(
      (set, get) => ({
        items: [],
        pendingOps: [],

        addItem: (item) => {
          const previousState = get().items;
          const opId = `add-${item.id}-${Date.now()}`;
          set((s) => ({
            items: [...s.items, item],
            pendingOps: [
              ...s.pendingOps,
              { id: opId, type: "add", item, previousState },
            ],
          }));
        },

        removeItem: (id) => {
          const previousState = get().items;
          const item = previousState.find((i) => i.id === id);
          if (!item) return;
          const opId = `remove-${id}-${Date.now()}`;
          set((s) => ({
            items: s.items.filter((i) => i.id !== id),
            pendingOps: [
              ...s.pendingOps,
              { id: opId, type: "remove", item, previousState },
            ],
          }));
        },

        updateItem: (id, patch) => {
          const previousState = get().items;
          const item = previousState.find((i) => i.id === id);
          if (!item) return;
          const opId = `update-${id}-${Date.now()}`;
          set((s) => ({
            items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
            pendingOps: [
              ...s.pendingOps,
              { id: opId, type: "update", item, previousState },
            ],
          }));
        },

        clear: () => set({ items: [], pendingOps: [] }),

        /** Roll back a failed optimistic operation */
        rollbackOp: (opId) => {
          const op = get().pendingOps.find((o) => o.id === opId);
          if (!op) return;
          set((s) => ({
            items: op.previousState,
            pendingOps: s.pendingOps.filter((o) => o.id !== opId),
          }));
        },

        /** Confirm a successful optimistic operation */
        confirmOp: (opId) =>
          set((s) => ({
            pendingOps: s.pendingOps.filter((o) => o.id !== opId),
          })),

        totalAmount: () =>
          get().items.reduce((sum, item) => sum + item.amount, 0),
      }),
      {
        name: "sheltaflex-cart-storage",
        storage: createJSONStorage(() => localStorage),
        version: 1,
        // Don't persist in-flight ops across reloads
        partialize: (state) => ({ items: state.items }),
      }
    ),
    "CartStore"
  )
);

export default useCartStore;
