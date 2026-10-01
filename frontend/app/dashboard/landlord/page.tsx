"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Building2,
  Users,
  MessageSquare,
  MapPin,
  Bed,
  Bath,
  Square,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MoneyValue,
  StatCardSkeleton,
} from "@/components/ui/data-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import {
  getLandlordDashboardStats,
  listLandlordProperties,
  listPropertyApplications,
  type LandlordDashboardStats,
  type LandlordPropertyRecord,
  type LandlordApplicationRecord,
} from "@/lib/landlordPropertiesApi";

export default function LandlordDashboard() {
  const [activeTab, setActiveTab] = useState<"properties" | "applications">(
    "properties",
  );

  const [stats, setStats] = useState<LandlordDashboardStats | null>(null);
  const [properties, setProperties] = useState<LandlordPropertyRecord[]>([]);
  const [applications, setApplications] = useState<
    Record<string, LandlordApplicationRecord[]>
  >({});

  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);

  const loadStats = useCallback(() => {
    getLandlordDashboardStats()
      .then((data) => {
        setStats(data);
        setStatsError(null);
      })
      .catch((err) => {
        console.error("Failed to load stats:", err);
        setStatsError(
          err instanceof Error ? err.message : "Failed to load stats",
        );
      })
      .finally(() => setStatsLoading(false));
  }, []);

  const loadProperties = useCallback(() => {
    listLandlordProperties()
      .then(async (res) => {
        setProperties(res.properties);

        const appPromises = res.properties
          .filter((p) => p.listingId)
          .map((p) =>
            listPropertyApplications(p.listingId!)
              .then((appRes) => ({
                listingId: p.listingId!,
                apps: appRes.applications,
              }))
              .catch(() => ({ listingId: p.listingId!, apps: [] })),
          );

        const appResults = await Promise.all(appPromises);
        const appMap: Record<string, LandlordApplicationRecord[]> = {};
        appResults.forEach(({ listingId, apps }) => {
          appMap[listingId] = apps;
        });

        setApplications(appMap);
        setPropertiesError(null);
      })
      .catch((err) => {
        console.error("Failed to load properties:", err);
        setPropertiesError(
          err instanceof Error ? err.message : "Failed to load properties",
        );
      })
      .finally(() => setPropertiesLoading(false));
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadProperties();
  }, [loadProperties]);

  // Retry handlers reset to the loading state before re-fetching. Kept separate
  // from the loaders above so the mount effects never call setState synchronously.
  const retryStats = useCallback(() => {
    setStatsLoading(true);
    setStatsError(null);
    loadStats();
  }, [loadStats]);

  const retryProperties = useCallback(() => {
    setPropertiesLoading(true);
    setPropertiesError(null);
    loadProperties();
  }, [loadProperties]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  // `money` entries go through MoneyValue so an absent figure renders as a dash
  // rather than as ₦0, which a landlord could reasonably read as "earned zero".
  const statsData = [
    {
      label: "Total Properties",
      value: stats?.totalProperties ?? null,
      money: false,
      icon: Building2,
      color: "bg-primary",
    },
    {
      label: "Active Listings",
      value: stats?.activeListings ?? null,
      money: false,
      icon: Building2,
      color: "bg-secondary",
    },
    {
      label: "Total Views",
      value: stats?.totalViews ?? null,
      money: false,
      icon: Eye,
      color: "bg-accent",
    },
    {
      label: "Monthly Revenue",
      value: stats?.monthlyRevenueNgn ?? null,
      money: true,
      icon: Building2,
      color: "bg-primary",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <DashboardSidebar
        role="landlord"
        userInfo={{ name: "Chief Okonkwo", roleLabel: "Landlord" }}
      />

      <main id="main-content" className="min-h-screen pt-20 lg:ml-64">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground md:text-3xl lg:text-4xl">
                Welcome back, Chief!
              </h1>
              <p className="mt-2 text-sm text-muted-foreground md:text-base lg:text-lg">
                Here&apos;s what&apos;s happening with your properties
              </p>
            </div>
            <Link href="/dashboard/landlord/properties/new">
              <Button className="w-full border-3 border-foreground bg-primary px-4 py-4 text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] md:w-auto md:px-6 md:py-6 md:text-lg">
                <Plus className="mr-2 h-4 w-4 md:h-5 md:w-5" />
                Add Property
              </Button>
            </Link>
          </div>

          {statsLoading ? (
            <LoadingState
              label="Loading portfolio stats"
              className="mb-6 grid grid-cols-2 gap-3 md:mb-8 md:grid-cols-4 md:gap-6"
            >
              {Array.from({ length: 4 }).map((_, index) => (
                <StatCardSkeleton key={`stats-loading-${index}`} />
              ))}
            </LoadingState>
          ) : statsError ? (
            <ErrorState
              className="mb-6 md:mb-8"
              title="Stats are currently unavailable"
              description={statsError}
              onRetry={retryStats}
            />
          ) : (
            <div className="mb-6 grid grid-cols-2 gap-3 md:mb-8 md:grid-cols-4 md:gap-6">
              {statsData.map((stat) => (
                <Card
                  key={stat.label}
                  className="border-3 border-foreground p-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6"
                >
                  <div className="flex items-center gap-2 md:gap-4">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center border-3 border-foreground md:h-14 md:w-14 ${stat.color}`}
                    >
                      <stat.icon className="h-5 w-5 md:h-7 md:w-7" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-muted-foreground md:text-sm">
                        {stat.label}
                      </p>
                      <p className="truncate text-xl font-bold text-foreground md:text-3xl">
                        {stat.money ? (
                          <MoneyValue
                            status="ready"
                            amount={stat.value}
                            format={formatCurrency}
                          />
                        ) : (
                          (stat.value?.toLocaleString() ?? "—")
                        )}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div
            className="mb-6 flex flex-wrap gap-2 md:gap-4"
            role="tablist"
            aria-label="Dashboard sections"
          >
            <button
              role="tab"
              aria-selected={activeTab === "properties"}
              onClick={() => setActiveTab("properties")}
              className={`border-3 border-foreground px-3 py-2 text-sm font-bold transition-all md:px-6 md:py-3 md:text-base ${
                activeTab === "properties"
                  ? "bg-foreground text-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                  : "bg-card hover:bg-muted"
              }`}
            >
              Properties
            </button>
          </div>

          {activeTab === "properties" && (
            <div className="grid gap-6">
              {propertiesLoading ? (
                <LoadingState label="Loading your properties" className="grid gap-6">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <Card
                      key={`properties-loading-${index}`}
                      className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    >
                      <Skeleton className="mb-4 h-6 w-56" />
                      <Skeleton className="mb-2 h-4 w-40" />
                      <Skeleton className="h-32 w-full" />
                    </Card>
                  ))}
                </LoadingState>
              ) : propertiesError ? (
                <ErrorState
                  title="Property data is unavailable"
                  description={propertiesError}
                  onRetry={retryProperties}
                />
              ) : properties.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="No properties yet"
                  description="List your first property to start receiving applications from verified tenants."
                  action={{
                    label: "Add your first property",
                    href: "/dashboard/landlord/properties/new",
                  }}
                />
              ) : (
                properties.map((property) => {
                  let statusBadgeClassName = "bg-muted";
                  let statusLabel = "Inactive";

                  if (
                    property.status === "active" ||
                    property.status === "approved"
                  ) {
                    statusBadgeClassName = "bg-secondary";
                    statusLabel = "Active";
                  } else if (
                    property.status === "pending" ||
                    property.status === "pending_review"
                  ) {
                    statusBadgeClassName = "bg-accent";
                    statusLabel = "Pending";
                  }

                  const propertyApps = property.listingId
                    ? applications[property.listingId] || []
                    : [];
                  const pendingApps = propertyApps.filter(
                    (app) => app.status === "pending",
                  );
                  const pendingCount = pendingApps.length;

                  return (
                    <Card
                      key={property.id}
                      className="border-3 border-foreground p-0 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    >
                      <div className="flex">
                        <div className="relative h-48 w-72 shrink-0 border-r-3 border-foreground bg-muted">
                          <div className="flex h-full items-center justify-center">
                            <Building2 className="h-16 w-16 text-muted-foreground" />
                          </div>
                          <div
                            className={`absolute left-3 top-3 border-2 border-foreground px-3 py-1 text-sm font-bold ${statusBadgeClassName}`}
                          >
                            {statusLabel}
                          </div>
                          {pendingCount > 0 && property.listingId && (
                            <Link
                              href={`/dashboard/landlord/properties/${property.listingId}/applications`}
                              aria-label={`${pendingCount} pending application${pendingCount !== 1 ? "s" : ""} for ${property.title}`}
                              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center border-2 border-foreground bg-destructive text-xs font-bold text-destructive-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)]"
                            >
                              <span aria-hidden="true">{pendingCount}</span>
                            </Link>
                          )}
                        </div>

                        <div className="flex flex-1 flex-col p-6">
                          <div className="mb-4 flex items-start justify-between">
                            <div>
                              <h3 className="text-xl font-bold text-foreground">
                                {property.title}
                              </h3>
                              <p className="mt-1 flex items-center gap-1 text-muted-foreground">
                                <MapPin className="h-4 w-4" />
                                {property.address}
                              </p>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="border-3 border-foreground bg-transparent"
                                  aria-label={`Options for ${property.title}`}
                                >
                                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="border-3 border-foreground">
                                {property.listingId && (
                                  <DropdownMenuItem asChild>
                                    <Link
                                      href={`/dashboard/landlord/properties/${property.listingId}/applications`}
                                      className="flex cursor-pointer items-center"
                                    >
                                      <Users className="mr-2 h-4 w-4" /> View
                                      Applications
                                    </Link>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem>
                                  <Edit className="mr-2 h-4 w-4" /> Edit
                                  Property
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                  <Eye className="mr-2 h-4 w-4" /> View Listing
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive">
                                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          <div className="mb-4 flex gap-6">
                            <span className="flex items-center gap-1 text-sm font-medium">
                              <Bed className="h-4 w-4" aria-hidden="true" />
                              {property.bedrooms} Beds
                            </span>
                            <span className="flex items-center gap-1 text-sm font-medium">
                              <Bath className="h-4 w-4" aria-hidden="true" />
                              {property.bathrooms} Baths
                            </span>
                            {property.sqm && (
                              <span className="flex items-center gap-1 text-sm font-medium">
                                <Square className="h-4 w-4" aria-hidden="true" />
                                {property.sqm} sqm
                              </span>
                            )}
                          </div>

                          <div className="mt-auto flex items-center justify-between">
                            <div className="flex items-center gap-6">
                              <p className="text-2xl font-bold text-primary">
                                <MoneyValue
                                  status="ready"
                                  amount={property.annualRentNgn}
                                  format={formatCurrency}
                                />
                                <span className="text-sm font-normal text-muted-foreground">
                                  /year
                                </span>
                              </p>
                              <div className="flex gap-4 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Eye className="h-4 w-4" /> {property.views}{" "}
                                  views
                                </span>
                                <span className="flex items-center gap-1">
                                  <MessageSquare className="h-4 w-4" />{" "}
                                  {property.inquiries} inquiries
                                </span>
                                {pendingCount > 0 && (
                                  <span className="flex items-center gap-1 font-medium text-destructive">
                                    <Users className="h-4 w-4" /> {pendingCount}{" "}
                                    pending
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
