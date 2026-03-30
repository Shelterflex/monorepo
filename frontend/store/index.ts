export { logger } from "./logger";

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
