import { StateCreator } from "zustand";

// Simple logger middleware for development
export const logger = <T>(
  config: StateCreator<T>,
  name: string
): StateCreator<T> => (set, get, api) =>
  config(
    (args) => {
      if (process.env.NODE_ENV === "development") {
        console.log(`  [Zustand Store: ${name}] applying:`, args);
      }
      set(args);
      if (process.env.NODE_ENV === "development") {
        console.log(`  [Zustand Store: ${name}] new state:`, get());
      }
    },
    get,
    api
  );

// Utility to check if we're in the browser
export const isBrowser = typeof window !== "undefined";

// Common persistence configuration
export const defaultPersistConfig = (name: string) => ({
  name: `sheltaflex-${name}-storage`,
  getStorage: () => localStorage,
  version: 1,
});

// Re-export all stores for convenient single-import access
export { default as useAuthStore } from "./useAuthStore";
export { default as useRiskStore } from "./useRiskStore";
export { default as usePreferencesStore } from "./usePreferencesStore";
export { default as useCartStore } from "./useCartStore";
export { default as useSessionStore } from "./useSessionStore";
