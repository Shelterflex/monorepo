"use client";

import { useState, useEffect, useCallback, Suspense, useRef } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Search, SlidersHorizontal, SearchX, X, Map, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PropertyCardSkeleton } from "@/components/property-card-skeleton";
import { VirtualizedPropertyList } from "@/components/virtualized-property-list";
import { EmptyState, LoadingState } from "@/components/ui/data-state";
import useAuthStore from "@/store/useAuthStore";
import {
  fetchSavedListingIds,
  setListingSaved,
} from "@/lib/savedPropertiesApi";
import {
  searchProperties,
  type PropertySearchFilters,
  type PropertyListing,
} from "@/lib/propertiesApi";
import { trackUserInteraction, startPropertyDiscovery, trackPropertyDiscoveryStep } from "@/lib/analytics-init";
import {
  parseCompareIds,
  canCompare,
  MIN_COMPARE,
} from "@/lib/compare";

const CITIES = ["Lagos", "Abuja", "Port Harcourt", "Ibadan", "Enugu"];
const BED_OPTIONS = ["Any", "1", "2", "3", "4", "4+"];
const BATH_OPTIONS = ["Any", "1", "2", "3", "3+"];
const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "bedrooms_desc", label: "Most Bedrooms" },
];

function PropertiesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [savedListingIds, setSavedListingIds] = useState<string[]>([]);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [showFilters, setShowFilters] = useState(false);
  const [properties, setProperties] = useState<PropertyListing[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(
    searchParams.get("query") || "",
  );

  const compareIds = parseCompareIds(searchParams.get("ids"));
  const canCompareProperties = canCompare(compareIds);

  const scrollTopRef = useRef(0);
  const [initialScrollTop, setInitialScrollTop] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = sessionStorage.getItem('properties_scroll_top');
    if (saved) {
      const y = parseInt(saved, 10);
      if (!isNaN(y)) {
        requestAnimationFrame(() => setInitialScrollTop(y));
      }
    }
    sessionStorage.removeItem('properties_scroll_top');
  }, []);

  const handleScrollTopChange = useCallback((y: number) => {
    scrollTopRef.current = y;
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('properties_scroll_top', String(scrollTopRef.current));
      }
    };
  }, []);

  // Filter state from URL
  const VALID_SORT = ["newest", "price_asc", "price_desc", "bedrooms_desc"];
  const rawSort = searchParams.get("sortBy") || "";
  const sortBy = VALID_SORT.includes(rawSort) ? rawSort : "newest";
  const rawPage = parseInt(searchParams.get("page") || "", 10);
  const page = !isNaN(rawPage) && rawPage > 0 ? rawPage : 1;
  const city = searchParams.get("city") || "";
  const area = searchParams.get("area") || "";
  const minBedrooms = searchParams.get("minBedrooms") || "";
  const maxBedrooms = searchParams.get("maxBedrooms") || "";
  const minBathrooms = searchParams.get("minBathrooms") || "";
  const maxBathrooms = searchParams.get("maxBathrooms") || "";
  const minAnnualRent = searchParams.get("minAnnualRent") || "";
  const maxAnnualRent = searchParams.get("maxAnnualRent") || "";

  const updateParams = (updates: Record<string, string>) => {
    const newParams = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (!value || value === "Any" || value === "newest") {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    // Reset to page 1 when filters change
    if (!updates.page) {
      newParams.delete("page");
    }
    router.push(`/properties?${newParams.toString()}`);
  };

  const clearAllFilters = () => {
    setSearchQuery("");
    router.push("/properties");
  };

  const hasActiveFilters =
    city ||
    area ||
    minBedrooms ||
    maxBedrooms ||
    minBathrooms ||
    maxBathrooms ||
    minAnnualRent ||
    maxAnnualRent;

  const fetchProperties = useCallback(async () => {
    setIsLoading(true);
    try {
      const filters: PropertySearchFilters = {
        sortBy: (sortBy as PropertySearchFilters["sortBy"]) || "newest",
        page,
        pageSize: 20,
      };

      if (searchQuery.trim()) filters.query = searchQuery.trim();
      if (city) filters.city = city;
      if (area) filters.area = area;
      if (minBedrooms && minBedrooms !== "Any")
        filters.minBedrooms = parseInt(minBedrooms, 10);
      if (maxBedrooms && maxBedrooms !== "Any" && maxBedrooms !== "4+")
        filters.maxBedrooms = parseInt(maxBedrooms, 10);
      if (maxBedrooms === "4+") filters.minBedrooms = 4;
      if (minBathrooms && minBathrooms !== "Any")
        filters.minBathrooms = parseInt(minBathrooms, 10);
      if (maxBathrooms && maxBathrooms !== "Any" && maxBathrooms !== "3+")
        filters.maxBathrooms = parseInt(maxBathrooms, 10);
      if (maxBathrooms === "3+") filters.minBathrooms = 3;
      if (minAnnualRent) filters.minAnnualRent = parseInt(minAnnualRent, 10);
      if (maxAnnualRent) filters.maxAnnualRent = parseInt(maxAnnualRent, 10);

      const result = await searchProperties(filters);
      setProperties(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (error) {
      console.error("Failed to fetch properties:", error);
      setProperties([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [
    searchQuery,
    city,
    area,
    minBedrooms,
    maxBedrooms,
    minBathrooms,
    maxBathrooms,
    minAnnualRent,
    maxAnnualRent,
    sortBy,
    page,
  ]);

  useEffect(() => {
    startPropertyDiscovery("anonymous");
    const debounce = setTimeout(() => {
      trackUserInteraction("property_search", { has_query: Boolean(searchQuery.trim()), has_filters: Boolean(city || area || minBedrooms || maxBedrooms || minBathrooms || maxBathrooms || minAnnualRent || maxAnnualRent) });
      trackPropertyDiscoveryStep("anonymous", "search_properties");
      void fetchProperties();
    }, 300);
    return () => clearTimeout(debounce);
  }, [fetchProperties, searchQuery, city, area, minBedrooms, maxBedrooms, minBathrooms, maxBathrooms, minAnnualRent, maxAnnualRent]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSavedListingIds([]);
      return;
    }

    let cancelled = false;
    fetchSavedListingIds()
      .then((ids) => {
        if (!cancelled) {
          setSavedListingIds(ids);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSavedListingIds([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const handleFavoriteChange = async (listingId: string, saved: boolean) => {
    await setListingSaved(listingId, saved);
    setSavedListingIds((prev) =>
      saved
        ? prev.includes(listingId)
          ? prev
          : [...prev, listingId]
        : prev.filter((id) => id !== listingId),
    );
  };

  const handleSaveToggle = useCallback(
    (listingId: string) => {
      const saved = !savedListingIds.includes(listingId);
      return handleFavoriteChange(listingId, saved);
    },
    [savedListingIds],
  );

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(price);
  };

  return (
    <main className="min-h-screen bg-background">
      {/* Hero Header */}
      <section className="border-b-3 border-foreground bg-muted py-12 md:py-16">
        <div className="container mx-auto px-4">
          <h1 className="mb-4 font-mono text-3xl font-black md:text-5xl">
            Find Your <span className="text-primary">Perfect Home</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Browse through our collection of verified rental properties. All
            listings come with our rent-now-pay-later option.
          </p>
        </div>
      </section>

      {/* Search & Filters */}
      <section className="border-b-3 border-foreground bg-card py-6">
        <div className="container mx-auto px-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1 max-w-xl">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by location or property name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    updateParams({ query: searchQuery });
                  }
                }}
                className="border-3 border-foreground bg-background pl-12 py-6 font-medium shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => updateParams({ query: searchQuery })}
                className="border-3 border-foreground bg-primary px-6 py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                Search
              </Button>
              <Link href={`/properties/map?${searchParams.toString()}`}>
                <Button className="border-3 border-foreground bg-background px-6 py-6 font-bold text-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                  <Map className="mr-2 h-5 w-5" />
                  Map View
                </Button>
              </Link>
              {canCompareProperties && (
                <Link href={`/properties/compare?${searchParams.toString()}`}>
                  <Button className="border-3 border-foreground bg-background px-6 py-6 font-bold text-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                    <Scale className="mr-2 h-5 w-5" />
                    Compare ({compareIds.length})
                  </Button>
                </Link>
              )}
              <Button
                onClick={() => setShowFilters(!showFilters)}
                className="border-3 border-foreground bg-background px-6 py-6 font-bold text-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                <SlidersHorizontal className="mr-2 h-5 w-5" />
                Filters
                {hasActiveFilters && (
                  <span className="ml-2 flex h-6 w-6 items-center justify-center bg-primary text-xs font-bold">
                    !
                  </span>
                )}
              </Button>
            </div>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className="mt-6 border-3 border-foreground bg-background p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-mono text-lg font-bold">
                  Filter Properties
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  className="text-sm underline"
                >
                  Clear All
                </Button>
              </div>

              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {/* City */}
                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    City
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {CITIES.map((c) => (
                      <button
                        key={c}
                        onClick={() =>
                          updateParams({ city: city === c ? "" : c })
                        }
                        className={`border-2 border-foreground px-3 py-2 text-sm font-medium transition-all ${
                          city === c
                            ? "bg-foreground text-background"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Area */}
                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    Neighbourhood
                  </p>
                  <Input
                    type="text"
                    placeholder="e.g. Lekki, Victoria Island"
                    defaultValue={area}
                    onChange={(e) => {
                      const val = e.target.value;
                      const timeout = setTimeout(() => updateParams({ area: val }), 400);
                      (e.target as HTMLInputElement).dataset.debounce = String(timeout);
                    }}
                    onBlur={(e) => {
                      const timeout = parseInt(e.target.dataset.debounce || "0", 10);
                      if (timeout) clearTimeout(timeout);
                      updateParams({ area: e.target.value });
                    }}
                    className="border-2 border-foreground bg-background"
                  />
                </div>

                {/* Bedrooms */}
                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    Bedrooms
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {BED_OPTIONS.map((beds) => (
                      <button
                        key={beds}
                        onClick={() =>
                          updateParams({
                            minBedrooms:
                              beds === "Any"
                                ? ""
                                : beds === "4+"
                                  ? "4"
                                  : beds,
                            maxBedrooms:
                              beds === "Any"
                                ? ""
                                : beds === "4+"
                                  ? ""
                                  : beds,
                          })
                        }
                        className={`border-2 border-foreground px-4 py-2 text-sm font-medium transition-all ${
                          (beds === "Any" && !minBedrooms && !maxBedrooms) ||
                          (beds === "4+" && minBedrooms === "4" && !maxBedrooms) ||
                          (beds !== "Any" &&
                            beds !== "4+" &&
                            minBedrooms === beds &&
                            maxBedrooms === beds)
                            ? "bg-foreground text-background"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {beds}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bathrooms */}
                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    Bathrooms
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {BATH_OPTIONS.map((baths) => (
                      <button
                        key={baths}
                        onClick={() =>
                          updateParams({
                            minBathrooms:
                              baths === "Any"
                                ? ""
                                : baths === "3+"
                                  ? "3"
                                  : baths,
                            maxBathrooms:
                              baths === "Any"
                                ? ""
                                : baths === "3+"
                                  ? ""
                                  : baths,
                          })
                        }
                        className={`border-2 border-foreground px-4 py-2 text-sm font-medium transition-all ${
                          (baths === "Any" && !minBathrooms && !maxBathrooms) ||
                          (baths === "3+" && minBathrooms === "3" && !maxBathrooms) ||
                          (baths !== "Any" &&
                            baths !== "3+" &&
                            minBathrooms === baths &&
                            maxBathrooms === baths)
                            ? "bg-foreground text-background"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {baths}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Price Range */}
                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    Annual Rent Range
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="Min"
                      value={minAnnualRent}
                      onChange={(e) =>
                        updateParams({ minAnnualRent: e.target.value })
                      }
                      className="border-2 border-foreground bg-background"
                    />
                    <span className="flex items-center">-</span>
                    <Input
                      type="number"
                      placeholder="Max"
                      value={maxAnnualRent}
                      onChange={(e) =>
                        updateParams({ maxAnnualRent: e.target.value })
                      }
                      className="border-2 border-foreground bg-background"
                    />
                  </div>
                </div>

                {/* Sort */}
                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    Sort By
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => updateParams({ sortBy: option.value })}
                        className={`border-2 border-foreground px-3 py-2 text-sm font-medium transition-all ${
                          sortBy === option.value
                            ? "bg-foreground text-background"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Active Filters Display */}
          {hasActiveFilters && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Active:</span>
              {city && (
                <Badge
                  variant="secondary"
                  className="cursor-pointer border-2 border-foreground"
                  onClick={() => updateParams({ city: "" })}
                >
                  {city} <X className="ml-1 h-3 w-3" />
                </Badge>
              )}
              {area && (
                <Badge
                  variant="secondary"
                  className="cursor-pointer border-2 border-foreground"
                  onClick={() => updateParams({ area: "" })}
                >
                  {area} <X className="ml-1 h-3 w-3" />
                </Badge>
              )}
              {(minBedrooms || maxBedrooms) && (
                <Badge
                  variant="secondary"
                  className="cursor-pointer border-2 border-foreground"
                  onClick={() =>
                    updateParams({ minBedrooms: "", maxBedrooms: "" })
                  }
                >
                  {minBedrooms || "0"}-{maxBedrooms || "∞"} bed{" "}
                  <X className="ml-1 h-3 w-3" />
                </Badge>
              )}
              {(minAnnualRent || maxAnnualRent) && (
                <Badge
                  variant="secondary"
                  className="cursor-pointer border-2 border-foreground"
                  onClick={() =>
                    updateParams({
                      minAnnualRent: "",
                      maxAnnualRent: "",
                    })
                  }
                >
                  {minAnnualRent
                    ? formatPrice(parseInt(minAnnualRent, 10))
                    : "₦0"}{" "}
                  -{" "}
                  {maxAnnualRent
                    ? formatPrice(parseInt(maxAnnualRent, 10))
                    : "∞"}{" "}
                  <X className="ml-1 h-3 w-3" />
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="text-xs underline"
              >
                Clear all
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Properties Grid */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <div className="mb-6 flex items-center justify-between">
            <p className="text-muted-foreground">
              Showing{" "}
              <span className="font-bold text-foreground">{total}</span>{" "}
              properties
            </p>
          </div>

          {isLoading ? (
            <LoadingState
              label="Loading properties"
              className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <PropertyCardSkeleton key={i} />
              ))}
            </LoadingState>
          ) : properties.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No properties found"
              description="Nothing matches this search yet. Clearing your filters widens the search across every city we cover."
              action={{ label: "Clear filters", onClick: clearAllFilters }}
            />
          ) : (
            <>
              <div className="h-[660px]">
                <VirtualizedPropertyList
                  properties={properties}
                  savedListingIds={savedListingIds}
                  onSaveToggle={handleSaveToggle}
                  isLoading={false}
                  showCompare={true}
                  initialScrollTop={initialScrollTop}
                  onScrollTopChange={handleScrollTopChange}
                />
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => updateParams({ page: String(page - 1) })}
                    className="border-2 border-foreground font-bold"
                  >
                    Previous
                  </Button>
                  <span className="px-4 font-mono font-bold">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => updateParams({ page: String(page + 1) })}
                    className="border-2 border-foreground font-bold"
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

export default function PropertiesClient() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <p className="font-mono font-bold text-muted-foreground">
            Loading properties...
          </p>
        </div>
      }
    >
      <PropertiesContent />
    </Suspense>
  );
}
