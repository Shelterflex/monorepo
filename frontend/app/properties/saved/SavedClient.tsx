"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Heart, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/data-state";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { PropertyCard } from "@/components/property-card";
import { PropertyCardSkeleton } from "@/components/property-card-skeleton";
import useAuthStore from "@/store/useAuthStore";
import {
  fetchSavedListingIds,
  setListingSaved,
} from "@/lib/savedPropertiesApi";
import { getProperty, type PropertyListing } from "@/lib/propertiesApi";
import { showErrorToast } from "@/lib/toast";

interface SavedProperty {
  listing: PropertyListing;
  removed?: boolean;
}

export default function SavedPropertiesPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [properties, setProperties] = useState<SavedProperty[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the effect below, which keeps the existing
  // cancel-on-unmount guard while giving the error state a real retry.
  const [reloadToken, setReloadToken] = useState(0);
  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadSaved() {
      setIsLoading(true);
      setError(null);
      try {
        const ids = await fetchSavedListingIds();
        if (cancelled) return;

        if (ids.length === 0) {
          setProperties([]);
          setIsLoading(false);
          return;
        }

        const results = await Promise.allSettled(
          ids.map((id) => getProperty(id)),
        );

        if (cancelled) return;

        const loaded: SavedProperty[] = [];
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result.status === "fulfilled" && result.value?.data) {
            loaded.push({ listing: result.value.data });
          }
          // Silently skip listings that no longer exist (delisted / deleted)
        }

        setProperties(loaded);
      } catch (err) {
        if (!cancelled) {
          setError("Could not load your saved properties. Please try again.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadSaved();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, reloadToken]);

  const handleUnsave = useCallback(
    async (listingId: string) => {
      // Optimistic removal
      setProperties((prev) =>
        prev.map((p) =>
          p.listing.listingId === listingId ? { ...p, removed: true } : p,
        ),
      );

      try {
        await setListingSaved(listingId, false);
        // Confirm removal after API success
        setProperties((prev) =>
          prev.filter((p) => p.listing.listingId !== listingId),
        );
      } catch (error) {
        // Rollback on failure
        setProperties((prev) =>
          prev.map((p) =>
            p.listing.listingId === listingId ? { ...p, removed: false } : p,
          ),
        );
        showErrorToast(error, "Could not remove saved property");
      }
    },
    [],
  );

  const visibleProperties = properties.filter((p) => !p.removed);

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <DashboardSidebar
        role="tenant"
        userInfo={{ name: "Tenant", roleLabel: "Tenant" }}
      />

      <main className="min-h-screen pt-20 lg:ml-64">
        <div className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8">
          {/* Header */}
          <div className="mb-8">
            <Link
              href="/properties"
              className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to search
            </Link>
            <div className="flex items-center gap-3">
              <Heart className="h-8 w-8 fill-destructive text-destructive" />
              <div>
                <h1 className="text-2xl font-bold text-foreground md:text-3xl">
                  Saved Properties
                </h1>
                <p className="text-sm text-muted-foreground">
                  {isLoading
                    ? "Loading your shortlist…"
                    : `${visibleProperties.length} saved ${visibleProperties.length === 1 ? "property" : "properties"}`}
                </p>
              </div>
            </div>
          </div>

          {/* Loading state */}
          {isLoading && (
            <LoadingState
              label="Loading saved properties"
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <PropertyCardSkeleton key={i} />
              ))}
            </LoadingState>
          )}

          {/* Error state */}
          {!isLoading && error && (
            <ErrorState
              title="Could not load your saved properties"
              description={error}
              onRetry={retry}
            />
          )}

          {/* Empty state */}
          {!isLoading && !error && visibleProperties.length === 0 && (
            <EmptyState
              icon={Heart}
              title="No saved properties yet"
              description="Tap the heart icon on any listing to save it here, then compare your shortlist side by side."
              action={{ label: "Browse properties", href: "/properties" }}
            />
          )}

          {/* Property grid */}
          {!isLoading && !error && visibleProperties.length > 0 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleProperties.map(({ listing }) => (
                  <PropertyCard
                    key={listing.listingId}
                    property={{
                      listingId: listing.listingId,
                      address: listing.address,
                      city: listing.city,
                      area: listing.area,
                      bedrooms: listing.bedrooms,
                      bathrooms: listing.bathrooms,
                      annualRentNgn: listing.annualRentNgn,
                      outrightPriceNgn: listing.outrightPriceNgn,
                      installmentBasePriceNgn: listing.installmentBasePriceNgn,
                      photos: listing.photos,
                      hasApprovedInspection: listing.hasApprovedInspection,
                    }}
                    isFavorited
                    onFavoriteChange={(saved) => {
                      if (!saved) {
                        handleUnsave(listing.listingId);
                      }
                    }}
                    href={`/properties/${listing.listingId}`}
                  />
                ))}
              </div>

              {/* Compare link */}
              {visibleProperties.length >= 2 && (
                <div className="mt-8 text-center">
                  <Link href="/properties/compare">
                    <Button
                      variant="outline"
                      className="border-3 border-foreground bg-card font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                    >
                      Compare {visibleProperties.length} Properties
                    </Button>
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
