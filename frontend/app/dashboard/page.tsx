"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import useAuthStore from "@/store/useAuthStore";

const roleRoutes: Record<string, string> = {
  tenant: "/dashboard/tenant",
  landlord: "/dashboard/landlord",
  inspector: "/",
  admin: "/admin",
  agent: "/dashboard/user",
  user: "/dashboard/user",
  super_admin: "/admin",
};

const subscribeToHydration = (onStoreChange: () => void) =>
  useAuthStore.persist.onFinishHydration(onStoreChange);
const getHydrationStatus = () => useAuthStore.persist.hasHydrated();

export default function DashboardRootPage() {
  const router = useRouter();
  const role = useAuthStore((state) => state.user?.role);
  const hasHydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydrationStatus,
    () => false,
  );

  useEffect(() => {
    if (hasHydrated) {
      router.replace(roleRoutes[role ?? ""] ?? "/dashboard/tenant");
    }
  }, [hasHydrated, role, router]);

  return null;
}
