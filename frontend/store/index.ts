import { StateCreator } from "zustand";

// Simple logger middleware for development
export const logger = <T>(
  config: StateCreator<T>,
  name: string
): StateCreator<T> => (set, get, api) =>
  config(
    (args) => {
      console.log(`  [Zustand Store: ${name}] applying:`, args);
      set(args);
      console.log(`  [Zustand Store: ${name}] new state:`, get());
    },
    get,
    api
  );

// Utility to check if we're in the browser
export const isBrowser = typeof window !== "undefined";

// Common persistence configuration
export const defaultPersistConfig = (name: string) => ({
  name: `sheltaflex-${name}-storage`,
  getStorage: () => localStorage, // Can be swapped for sessionStorage or indexedDB
  version: 1, // Current version for migrations
});
