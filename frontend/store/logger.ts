import { StateCreator } from "zustand";

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
