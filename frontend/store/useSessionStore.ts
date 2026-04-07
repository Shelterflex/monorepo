import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface SessionState {
  /** Last visited route — used to restore navigation on reload */
  lastRoute: string | null;
  /** Ephemeral UI state (e.g. which tab is open) */
  activeTab: string | null;
  /** Notification badge counts */
  unreadCount: number;
  /** Whether the sidebar is collapsed */
  sidebarCollapsed: boolean;

  // Actions
  setLastRoute: (route: string) => void;
  setActiveTab: (tab: string | null) => void;
  setUnreadCount: (count: number) => void;
  toggleSidebar: () => void;
  reset: () => void;
}

const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      lastRoute: null,
      activeTab: null,
      unreadCount: 0,
      sidebarCollapsed: false,

      setLastRoute: (route) => set({ lastRoute: route }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setUnreadCount: (count) => set({ unreadCount: count }),
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      reset: () =>
        set({
          lastRoute: null,
          activeTab: null,
          unreadCount: 0,
          sidebarCollapsed: false,
        }),
    }),
    {
      name: "shelterflex-session-storage",
      // sessionStorage clears on tab close — appropriate for session data
      storage: createJSONStorage(() =>
        globalThis.window === undefined ? localStorage : sessionStorage
      ),
      version: 1,
    }
  )
);

export default useSessionStore;
