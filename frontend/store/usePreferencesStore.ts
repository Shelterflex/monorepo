import { create } from "zustand";
import { persist, createJSONStorage, temporal } from "zustand/middleware";
import { logger } from "./index";

export interface UserPreferences {
  theme: "light" | "dark" | "system";
  currency: string;
  language: string;
  notificationsEnabled: boolean;
  compactView: boolean;
}

interface PreferencesState extends UserPreferences {
  // Conflict resolution
  lastSyncedAt: string | null;
  isDirty: boolean;

  // Actions
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

        setPreference: (key, value) =>
          set({ [key]: value, isDirty: true }),

        /**
         * Conflict resolution: server wins only if server timestamp is newer
         * than the last local sync. Otherwise local (user) changes are kept.
         */
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
        // Don't persist internal sync metadata — only user prefs
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
