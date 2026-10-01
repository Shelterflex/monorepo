"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Building2,
  MapPin,
  Bed,
  Bath,
  Square,
  MoreVertical,
  Edit,
  Eye,
  EyeOff,
  RotateCcw,
  Trash2,
  Search,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PropertyImageCarousel } from "@/components/property-card";
import { PropertyCardSkeleton } from "@/components/property-card-skeleton";
import {
  type LandlordPropertyRecord,
  type LandlordPropertyStatus,
  listLandlordProperties,
  deactivateLandlordProperty,
  relistLandlordProperty,
  deleteLandlordProperty,
} from "@/lib/landlordPropertiesApi";
import { showSuccessToast, showErrorToast } from "@/lib/toast";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";

function formatLocation(property: LandlordPropertyRecord): string {
  const parts = [property.area, property.city].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : property.address;
}

function statusPresentation(status: LandlordPropertyStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "approved":
    case "active":
      return { label: "Approved", className: "bg-green-100 text-green-800" };
    case "rented":
      return { label: "Rented", className: "bg-blue-100 text-blue-800" };
    case "pending_review":
    case "pending":
      return { label: "Pending Review", className: "bg-yellow-100 text-yellow-800" };
    case "deactivated":
    case "inactive":
      return { label: "Deactivated", className: "bg-gray-100 text-gray-800" };
    default:
      return { label: status, className: "bg-gray-100 text-gray-800" };
  }
}

export default function LandlordPropertiesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [properties, setProperties] = useState<LandlordPropertyRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadProperties = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const result = await listLandlordProperties({
        query: searchQuery || undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setProperties(result.properties);
    } catch (error) {
      setLoadError(true);
      showErrorToast(error, "Failed to load properties");
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(loadProperties, 300);
    return () => clearTimeout(timer);
  }, [loadProperties]);

  const filteredProperties = useMemo(() => {
    if (!searchQuery.trim()) return properties;
    const q = searchQuery.toLowerCase();
    return properties.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        formatLocation(p).toLowerCase().includes(q),
    );
  }, [properties, searchQuery]);

  const handleDeactivate = async (id: string) => {
    try {
      await deactivateLandlordProperty(id);
      showSuccessToast("Listing deactivated.");
      loadProperties();
    } catch (error) {
      showErrorToast(error, "Failed to deactivate");
    }
  };

  const handleRelist = async (id: string) => {
    try {
      await relistLandlordProperty(id);
      showSuccessToast("Listing submitted for review again.");
      loadProperties();
    } catch (error) {
      showErrorToast(error, "Failed to relist");
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteLandlordProperty(deleteTarget);
      showSuccessToast("Property deleted.");
      loadProperties();
    } catch (error) {
      showErrorToast(error, "Failed to delete property");
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  const statusFilters = [
    { value: "all", label: "All" },
    { value: "pending_review", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rented", label: "Rented" },
    { value: "deactivated", label: "Deactivated" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        role="landlord"
        userInfo={{ name: "Chief Okonkwo", roleLabel: "Landlord" }}
      />

      <main id="main-content" className="lg:ml-64 min-h-screen pt-20">
        <div className="p-8">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">My Properties</h1>
              <p className="mt-1 text-muted-foreground">
                Manage listings, pricing, and availability
              </p>
            </div>
            <Link href="/dashboard/landlord/properties/new">
              <Button className="border-3 border-foreground bg-primary px-6 py-5 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <Plus className="mr-2 h-5 w-5" />
                Add Property
              </Button>
            </Link>
          </div>

          <div className="mb-6 flex flex-col gap-4 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search properties..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border-3 border-foreground bg-background pl-12 py-5 font-medium"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {statusFilters.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={`border-3 border-foreground px-4 py-2 font-bold ${
                    statusFilter === value
                      ? "bg-foreground text-background"
                      : "bg-card hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-6">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <PropertyCardSkeleton
                  key={`property-loading-${index}`}
                  variant="horizontal"
                />
              ))
            ) : loadError ? (
              <Card className="border-3 border-foreground bg-destructive/10 p-12 text-center">
                <AlertTriangle className="mx-auto h-16 w-16 text-destructive" />
                <h3 className="mt-4 text-xl font-bold">Properties unavailable</h3>
                <p className="mt-2 text-muted-foreground">
                  Could not load your properties. Please try again.
                </p>
                <Button
                  onClick={loadProperties}
                  className="mt-6 border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                >
                  Retry
                </Button>
              </Card>
            ) : filteredProperties.length === 0 ? (
              <Card className="border-3 border-foreground p-12 text-center">
                <Building2 className="mx-auto h-16 w-16 text-muted-foreground" />
                <h3 className="mt-4 text-xl font-bold">No properties found</h3>
                <p className="mt-2 text-muted-foreground">
                  {searchQuery || statusFilter !== "all"
                    ? "Try adjusting your filters."
                    : "Add your first property to get started."}
                </p>
                {!searchQuery && statusFilter === "all" && (
                  <Link href="/dashboard/landlord/properties/new">
                    <Button className="mt-6 border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Property
                    </Button>
                  </Link>
                )}
              </Card>
            ) : (
              filteredProperties.map((property) => {
                const { label, className } = statusPresentation(property.status);
                const canDeactivate =
                  property.status === "approved" ||
                  property.status === "active" ||
                  property.status === "rented";
                const canRelist =
                  property.status === "deactivated" ||
                  property.status === "inactive";

                return (
                  <Card
                    key={property.id}
                    className="border-3 border-foreground p-0 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                  >
                    <div className="flex">
                      <div className="relative w-72 shrink-0 border-r-3 border-foreground">
                        <PropertyImageCarousel
                          property={{
                            listingId: String(property.id),
                            address: property.title,
                            bedrooms: property.bedrooms,
                            bathrooms: property.bathrooms,
                            annualRentNgn: property.annualRentNgn,
                            photos: property.photos,
                            hasApprovedInspection: false,
                          }}
                          className="aspect-auto h-48 w-full border-0"
                          overlay={
                            <div
                              className={`absolute left-3 top-3 z-10 border-2 border-foreground px-3 py-1 text-sm font-bold ${className}`}
                            >
                              {label}
                            </div>
                          }
                        />
                      </div>

                      <div className="flex flex-1 flex-col p-6">
                        <div className="mb-4 flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-xl font-bold">{property.title}</h3>
                            <p className="mt-1 flex items-center gap-1 text-muted-foreground">
                              <MapPin className="h-4 w-4 shrink-0" />
                              {formatLocation(property)}
                            </p>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                className="border-3 border-foreground"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="border-3 border-foreground">
                              <DropdownMenuItem asChild>
                                <Link
                                  href={`/dashboard/landlord/properties/${property.id}/edit`}
                                  className="flex cursor-pointer items-center"
                                >
                                  <Edit className="mr-2 h-4 w-4" />
                                  Edit
                                </Link>
                              </DropdownMenuItem>
                              {property.listingId && (
                                <DropdownMenuItem asChild>
                                  <Link
                                    href={`/properties/${property.listingId}`}
                                    className="flex cursor-pointer items-center"
                                  >
                                    <Eye className="mr-2 h-4 w-4" />
                                    View listing
                                  </Link>
                                </DropdownMenuItem>
                              )}
                              {canDeactivate && (
                                <DropdownMenuItem
                                  onClick={() => handleDeactivate(property.id)}
                                >
                                  <EyeOff className="mr-2 h-4 w-4" />
                                  Deactivate
                                </DropdownMenuItem>
                              )}
                              {canRelist && (
                                <DropdownMenuItem
                                  onClick={() => handleRelist(property.id)}
                                >
                                  <RotateCcw className="mr-2 h-4 w-4" />
                                  Relist
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(property.id)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        <div className="mb-4 flex flex-wrap gap-4 text-sm font-medium">
                          <span className="flex items-center gap-1">
                            <Bed className="h-4 w-4" />
                            {property.bedrooms} beds
                          </span>
                          <span className="flex items-center gap-1">
                            <Bath className="h-4 w-4" />
                            {property.bathrooms} baths
                          </span>
                          {property.sqm != null && (
                            <span className="flex items-center gap-1">
                              <Square className="h-4 w-4" />
                              {property.sqm} sqm
                            </span>
                          )}
                        </div>

                        <div className="mt-auto flex flex-wrap items-end justify-between gap-4">
                          <div>
                            <p className="text-2xl font-bold text-primary">
                              ₦
                              {(
                                property.installmentBasePriceNgn ??
                                property.annualRentNgn
                              ).toLocaleString()}
                              <span className="text-sm font-normal text-muted-foreground">
                                {" "}
                                / yr instalment base
                              </span>
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {property.views} views · {property.inquiries} inquiries
                            </p>
                          </div>
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

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent className="border-3 border-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete property?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The property and all associated data
              will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isDeleting}
              className="border-3 border-foreground"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="border-3 border-foreground bg-destructive text-destructive-foreground"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
