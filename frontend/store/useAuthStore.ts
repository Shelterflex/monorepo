import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { logger } from "./logger";
import { getToken, setToken as saveToken, clearToken } from "@/lib/auth";

interface User {
  id: string;
  email: string;
  name?: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  setToken: (token: string | null) => void;
  setUser: (user: User | null) => void;
  logout: () => void;
}

const useAuthStore = create<AuthState>()(
  logger(
    persist(
      (set) => ({
        token: getToken(),
        user: null,
        isAuthenticated: !!getToken(),
        setToken: (token) => {
          if (token) {
            saveToken(token);
          } else {
            clearToken();
          }
          set({ token, isAuthenticated: !!token });
        },
        setUser: (user) => set({ user }),
        logout: () => {
          clearToken();
          set({ token: null, user: null, isAuthenticated: false });
        },
      }),
      {
        name: "sheltaflex-auth-storage",
        storage: createJSONStorage(() => localStorage),
        version: 1,
      }
    ),
    "AuthStore"
  )
);

export default useAuthStore;
