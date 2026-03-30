import { create } from "zustand";
import { persist, createJSONStorage, temporal } from "zustand/middleware";
import { logger } from "./logger";

export interface UserPreferences {
  theme: "light" | "dark" | "system";
  currency: string;
  language: string;
  notificationsEnabled: boolean;
  compactView: boolean;
}

interface PreferencesState extends UserPreferences {
  lastSyncedAt: string | null;
  isDirty: boolean;
  setPreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  mergeServerPreferences: (serverPrefs: Partial<UserPreferences>, serverTimestamp: string) => void;
  markSynced: (timestamp: string) => void;
  reset: () => void;
}

const defaults: UserPreferences = {
  theme: "system",
  currency: "NGN",
  language: "en",
  notificationsEnabled: true,
  compactView: false,
};

const usePreferencesStore = create<PreferencesState>()(
  logger(
    persist(
      (set, get) => ({
        ...defaults,
        lastSyncedAt: null,
        isDirty: false,

        setPreference: (key, value) => set({ [key]: value, isDirty: true }),

        mergeServerPreferences: (serverPrefs, serverTimestamp) => {
          const { lastSyncedAt } = get();
          const serverIsNewer =
            !lastSyncedAt || new Date(serverTimestamp) > new Date(lastSyncedAt);

          if (serverIsNewer) {
            set({ ...serverPrefs, lastSyncedAt: serverTimestamp, isDirty: false });
          }
        },

        markSynced: (timestamp) => set({ lastSyncedAt: timestamp, isDirty: false }),

        reset: () => set({ ...defaults, lastSyncedAt: null, isDirty: false }),
      }),
      {
        name: "sheltaflex-preferences-storage",
        storage: createJSONStorage(() => localStorage),
        version: 1,
        // Persist user-facing preferences while leaving sync metadata internal.
        partialize: (state) => ({
          theme: state.theme,
          currency: state.currency,
          language: state.language,
          notificationsEnabled: state.notificationsEnabled,
          compactView: state.compactView,
          lastSyncedAt: state.lastSyncedAt,
        }),
      }
    ),
    "PreferencesStore"
  )
);

export default usePreferencesStore;
