"use client";

import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { RatingCardClient } from "@/components/tenant/RatingCardClient";
import useAuthStore from "@/store/useAuthStore";

/**
 * Tenant rating card dashboard (#1923): aggregate card plus share-link
 * management. Gated by the dashboard AuthGuard and reached from the tenant
 * sidebar nav.
 */
export default function TenantRatingCardPage() {
  const user = useAuthStore((state) => state.user);
  const userName = user?.name?.trim() || "Tenant";

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <DashboardSidebar role="tenant" userInfo={{ name: userName, roleLabel: "Tenant" }} />
        <main id="dashboard-main-content" className="min-w-0 space-y-6">
          <div>
            <h1 className="font-mono text-2xl font-black">Rating Card</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              How landlords have rated you across your deals — and the links you
              share with future landlords.
            </p>
          </div>
          <RatingCardClient />
        </main>
      </div>
    </div>
  );
}
