"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Home,
  Plus,
  Building2,
  Users,
  MessageSquare,
  Settings,
  MapPin,
  Bed,
  Bath,
  Square,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
  Menu,
  X,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DashboardHeader } from "@/components/dashboard-header";
import {
  landlordDashboardStats,
  landlordMyProperties,
} from "@/lib/mockData";

export default function LandlordDashboard() {
  const [activeTab, setActiveTab] = useState<"properties" | "applications">(
    "properties",
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 350);
    return () => clearTimeout(timer);
  }, []);

  const statsUnavailable = !Array.isArray(landlordDashboardStats);
  const propertiesUnavailable = !Array.isArray(landlordMyProperties);

  const stats = useMemo(
    () => (Array.isArray(landlordDashboardStats) ? landlordDashboardStats : []),
    [],
  );

  const myProperties = useMemo(
    () => (Array.isArray(landlordMyProperties) ? landlordMyProperties : []),
    [],
  );

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      {/* Mobile Menu Button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center border-3 border-foreground bg-primary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] lg:hidden"
      >
        {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-foreground/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-40 h-screen w-64 border-r-3 border-foreground bg-card pt-20 transition-transform lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-full flex-col px-4 py-6">
          <div className="mb-8 border-3 border-foreground bg-accent p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <p className="text-sm font-medium text-foreground">Logged in as</p>
            <p className="text-lg font-bold text-foreground">Chief Okonkwo</p>
            <p className="text-sm text-muted-foreground">Landlord</p>
          </div>

          <nav className="flex-1 space-y-2">
            <Link
              href="/dashboard/landlord"
              className="flex items-center gap-3 border-3 border-foreground bg-primary p-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              onClick={() => setSidebarOpen(false)}
            >
              <Home className="h-5 w-5" />
              Dashboard
            </Link>
            <Link
              href="/dashboard/landlord/properties"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              onClick={() => setSidebarOpen(false)}
            >
              <Building2 className="h-5 w-5" />
              My Properties
            </Link>
            <Link
              href="/dashboard/landlord/tenants"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              onClick={() => setSidebarOpen(false)}
            >
              <Users className="h-5 w-5" />
              My Tenants
            </Link>
            <Link
              href="/messages"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              onClick={() => setSidebarOpen(false)}
            >
              <MessageSquare className="h-5 w-5" />
              Messages
              <span className="ml-auto flex h-6 w-6 items-center justify-center border-2 border-foreground bg-destructive text-xs font-bold text-destructive-foreground">
                3
              </span>
            </Link>
            <Link
              href="/dashboard/landlord/settings"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              onClick={() => setSidebarOpen(false)}
            >
              <Settings className="h-5 w-5" />
              Settings
            </Link>
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="min-h-screen pt-20 lg:ml-64">
        <div className="p-4 md:p-6 lg:p-8">
          {/* Header */}
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

          {/* Stats Grid */}
          <div className="mb-6 grid grid-cols-2 gap-3 md:mb-8 md:grid-cols-4 md:gap-6">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <Card
                  key={`stats-loading-${index}`}
                  className="border-3 border-foreground p-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6"
                >
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-8 w-16" />
                  </div>
                </Card>
              ))
            ) : statsUnavailable ? (
              <Card className="col-span-2 border-3 border-foreground bg-destructive/10 p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:col-span-4 md:p-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
                  <div>
                    <p className="font-bold">Stats are currently unavailable</p>
                    <p className="text-sm text-muted-foreground">
                      We couldn&apos;t load dashboard stats right now.
                    </p>
                  </div>
                </div>
              </Card>
            ) : stats.length === 0 ? (
              <Card className="col-span-2 border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:col-span-4 md:p-6">
                <p className="font-bold">No stats available yet</p>
                <p className="text-sm text-muted-foreground">
                  Your non-loading dashboard stats will appear here when data is available.
                </p>
              </Card>
            ) : (
              stats.map((stat) => (
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
                        {stat.value}
                      </p>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>

          {/* Tabs */}
          <div className="mb-6 flex flex-wrap gap-2 md:gap-4">
            <button
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

          {/* Properties Tab */}
          {activeTab === "properties" && (
            <div className="grid gap-6">
              {isLoading ? (
                Array.from({ length: 2 }).map((_, index) => (
                  <Card
                    key={`properties-loading-${index}`}
                    className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                  >
                    <Skeleton className="mb-4 h-6 w-56" />
                    <Skeleton className="mb-2 h-4 w-40" />
                    <Skeleton className="h-32 w-full" />
                  </Card>
                ))
              ) : propertiesUnavailable ? (
                <Card className="border-3 border-foreground bg-destructive/10 p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
                    <div>
                      <p className="font-bold">Property data is unavailable</p>
                      <p className="text-sm text-muted-foreground">
                        We couldn&apos;t load your property panel right now.
                      </p>
                    </div>
                  </div>
                </Card>
              ) : myProperties.length === 0 ? (
                <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <p className="font-bold">No properties yet</p>
                  <p className="text-sm text-muted-foreground">
                    This is an empty non-loading state. Add your first property to populate this panel.
                  </p>
                </Card>
              ) : (
                myProperties.map((property) => {
                  let statusBadgeClassName = "bg-muted";
                  if (property.status === "active") {
                    statusBadgeClassName = "bg-secondary";
                  } else if (property.status === "pending") {
                    statusBadgeClassName = "bg-accent";
                  }

                  let statusLabel = "Inactive";
                  if (property.status === "active") {
                    statusLabel = "Active";
                  } else if (property.status === "pending") {
                    statusLabel = "Pending";
                  }

                  return (
                    <Card
                      key={property.id}
                      className="border-3 border-foreground p-0 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    >
                      <div className="flex">
                        {/* Property Image */}
                        <div className="relative h-48 w-72 shrink-0 border-r-3 border-foreground bg-muted">
                          <div className="flex h-full items-center justify-center">
                            <Building2 className="h-16 w-16 text-muted-foreground" />
                          </div>
                          <div
                            className={`absolute left-3 top-3 border-2 border-foreground px-3 py-1 text-sm font-bold ${statusBadgeClassName}`}
                          >
                            {statusLabel}
                          </div>
                        </div>

                        {/* Property Details */}
                        <div className="flex flex-1 flex-col p-6">
                          <div className="mb-4 flex items-start justify-between">
                            <div>
                              <h3 className="text-xl font-bold text-foreground">
                                {property.title}
                              </h3>
                              <p className="mt-1 flex items-center gap-1 text-muted-foreground">
                                <MapPin className="h-4 w-4" />
                                {property.location}
                              </p>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="border-3 border-foreground bg-transparent"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="border-3 border-foreground">
                                <DropdownMenuItem>
                                  <Edit className="mr-2 h-4 w-4" /> Edit Property
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
                              <Bed className="h-4 w-4" /> {property.beds} Beds
                            </span>
                            <span className="flex items-center gap-1 text-sm font-medium">
                              <Bath className="h-4 w-4" /> {property.baths} Baths
                            </span>
                            <span className="flex items-center gap-1 text-sm font-medium">
                              <Square className="h-4 w-4" /> {property.sqm} sqm
                            </span>
                          </div>

                          <div className="mt-auto flex items-center justify-between">
                            <div className="flex items-center gap-6">
                              <p className="text-2xl font-bold text-primary">
                                ₦{property.price.toLocaleString()}
                                <span className="text-sm font-normal text-muted-foreground">
                                  /year
                                </span>
                              </p>
                              <div className="flex gap-4 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Eye className="h-4 w-4" /> {property.views} views
                                </span>
                                <span className="flex items-center gap-1">
                                  <MessageSquare className="h-4 w-4" />{" "}
                                  {property.inquiries} inquiries
                                </span>
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
