"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Home,
  Plus,
  Building2,
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
  Clock,
  Search,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { landlordProperties } from "@/lib/mockData";

export default function LandlordPropertiesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 350);
    return () => clearTimeout(timer);
  }, []);

  const propertiesUnavailable = !Array.isArray(landlordProperties);

  const myProperties = useMemo(
    () => (Array.isArray(landlordProperties) ? landlordProperties : []),
    [],
  );

  const filteredProperties = myProperties.filter((property) => {
    const matchesSearch =
      property.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      property.location.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || property.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r-3 border-foreground bg-card pt-20">
        <div className="flex h-full flex-col px-4 py-6">
          <div className="mb-8 border-3 border-foreground bg-accent p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <p className="text-sm font-medium text-foreground">Logged in as</p>
            <p className="text-lg font-bold text-foreground">Chief Okonkwo</p>
            <p className="text-sm text-muted-foreground">Landlord</p>
          </div>

          <nav className="flex-1 space-y-2">
            <Link
              href="/dashboard/landlord"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <Home className="h-5 w-5" />
              Dashboard
            </Link>
            <Link
              href="/dashboard/landlord/properties"
              className="flex items-center gap-3 border-3 border-foreground bg-primary p-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <Building2 className="h-5 w-5" />
              My Properties
            </Link>
            <Link
              href="/messages"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <MessageSquare className="h-5 w-5" />
              Messages
            </Link>
            <Link
              href="/dashboard/landlord/settings"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <Settings className="h-5 w-5" />
              Settings
            </Link>
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 min-h-screen pt-20">
        <div className="p-8">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                My Properties
              </h1>
              <p className="mt-1 text-muted-foreground">
                Manage all your listed properties
              </p>
            </div>
            <Link href="/dashboard/landlord/properties/new">
              <Button className="border-3 border-foreground bg-primary px-6 py-5 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                <Plus className="mr-2 h-5 w-5" />
                Add Property
              </Button>
            </Link>
          </div>

          {/* Filters */}
          <div className="mb-6 flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search properties..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border-3 border-foreground bg-background pl-12 py-5 font-medium shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
              />
            </div>
            <div className="flex gap-2">
              {["all", "active", "pending", "inactive"].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`border-3 border-foreground px-4 py-2 font-bold capitalize transition-all ${
                    statusFilter === status
                      ? "bg-foreground text-background"
                      : "bg-card hover:bg-muted"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* Properties Grid */}
          <div className="grid gap-6">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <Card
                  key={`property-loading-${index}`}
                  className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                >
                  <Skeleton className="mb-4 h-6 w-56" />
                  <Skeleton className="mb-2 h-4 w-40" />
                  <Skeleton className="h-32 w-full" />
                </Card>
              ))
            ) : propertiesUnavailable ? (
              <Card className="border-3 border-foreground bg-destructive/10 p-12 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <AlertTriangle className="mx-auto h-16 w-16 text-destructive" />
                <h3 className="mt-4 text-xl font-bold">Properties unavailable</h3>
                <p className="mt-2 text-muted-foreground">
                  We couldn&apos;t load property records at the moment.
                </p>
              </Card>
            ) : filteredProperties.length === 0 ? (
              <Card className="border-3 border-foreground p-12 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <Building2 className="mx-auto h-16 w-16 text-muted-foreground" />
                <h3 className="mt-4 text-xl font-bold">No Properties Found</h3>
                <p className="mt-2 text-muted-foreground">
                  {searchQuery
                    ? "Try a different search term"
                    : "This is an empty non-loading state. Start by adding your first property."}
                </p>
              </Card>
            ) : (
              filteredProperties.map((property) => {
                let statusBadgeClass = "bg-muted";
                let statusLabel = "Inactive";

                switch (property.status) {
                  case "active":
                    statusBadgeClass = "bg-secondary";
                    statusLabel = "Active";
                    break;
                  case "pending":
                    statusBadgeClass = "bg-accent";
                    statusLabel = "Pending";
                    break;
                  default:
                    break;
                }

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
                          className={`absolute left-3 top-3 border-2 border-foreground px-3 py-1 text-sm font-bold ${statusBadgeClass}`}
                        >
                          {statusLabel}
                        </div>
                      </div>

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

                          {property.tenant ? (
                            <div className="flex items-center gap-3 border-3 border-foreground bg-secondary/30 px-4 py-2">
                              <div className="flex h-10 w-10 items-center justify-center border-2 border-foreground bg-secondary font-bold">
                                {property.tenant.avatar}
                              </div>
                              <div>
                                <p className="text-sm font-bold">
                                  {property.tenant.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Current Tenant
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 border-3 border-dashed border-foreground bg-accent/30 px-4 py-2">
                              <Clock className="h-5 w-5" />
                              <span className="font-medium">Vacant</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
