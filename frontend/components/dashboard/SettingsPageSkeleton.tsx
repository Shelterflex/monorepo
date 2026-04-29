import { DashboardHeader } from "@/components/dashboard-header";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsPageSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r-3 border-foreground bg-card pt-20">
        <div className="flex h-full flex-col px-4 py-6">
          <div className="mb-8 border-3 border-foreground p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-6 w-36" />
            <Skeleton className="mt-2 h-4 w-20" />
          </div>

          <div className="space-y-2">
            {["dashboard", "properties", "tenants", "messages", "settings"].map((item) => (
              <Skeleton key={`settings-nav-${item}`} className="h-12 w-full" />
            ))}
          </div>
        </div>
      </aside>

      <main className="ml-64 min-h-screen pt-20">
        <div className="p-8">
          <div className="mb-8">
            <Skeleton className="h-10 w-44" />
            <Skeleton className="mt-2 h-4 w-72" />
          </div>

          <div className="mb-6 flex gap-2">
            {["profile", "notifications", "security", "payment"].map((tab) => (
              <Skeleton key={`settings-tab-${tab}`} className="h-12 w-32" />
            ))}
          </div>

          <div className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <Skeleton className="mb-6 h-8 w-56" />
            <div className="grid gap-6 md:grid-cols-2">
              {["name", "email", "phone", "address", "password", "confirm"].map((field) => (
                <div key={`settings-field-${field}`}>
                  <Skeleton className="mb-2 h-4 w-24" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
