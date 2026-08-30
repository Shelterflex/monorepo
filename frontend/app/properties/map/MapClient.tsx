"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, Suspense } from "react";
import dynamicImport from "next/dynamic";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  SlidersHorizontal,
  List,
  MapPin,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  searchProperties,
  type PropertySearchFilters,
  type PropertyListing,
} from "@/lib/propertiesApi";

// Dynamically import the map so it only renders client-side (Leaflet requires window)
const PropertyMap = dynamicImport(
  () => import("@/components/PropertyMap").then((m) => m.PropertyMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-muted">
        <p className="font-mono font-bold text-muted-foreground">
          Loading map...
        </p>
      </div>
    ),
  },
);

const CITIES = ["Lagos", "Abuja", "Port Harcourt", "Ibadan", "Enugu"];
const BED_OPTIONS = ["Any", "1", "2", "3", "4", "4+"];
const BATH_OPTIONS = ["Any", "1", "2", "3", "3+"];
const LAGOS_CENTER: [number, number] = [6.5244, 3.3792];

// ---------------------------------------------------------------------------
// Filter panel — shared between sidebar and bottom-sheet drawer
// ---------------------------------------------------------------------------

interface FilterPanelProps {
  city: string;
  area: string;
  minBedrooms: string;
  maxBedrooms: string;
  minBathrooms: string;
  maxBathrooms: string;
  minAnnualRent: string;
  maxAnnualRent: string;
  updateParams: (updates: Record<string, string>) => void;
  clearAllFilters: () => void;
}

function FilterPanel({
  city,
  area,
  minBedrooms,
  maxBedrooms,
  minBathrooms,
  maxBathrooms,
  minAnnualRent,
  maxAnnualRent,
  updateParams,
  clearAllFilters,
}: FilterPanelProps) {
  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-base font-black">Filter Properties</h3>
        <button
          onClick={clearAllFilters}
          className="text-xs underline font-medium"
        >
          Clear All
        </button>
      </div>

      {/* City */}
      <div>
        <p className="mb-2 font-mono text-sm font-bold">City</p>
        <div className="flex flex-wrap gap-2">
          {CITIES.map((c) => (
            <button
              key={c}
              onClick={() => updateParams({ city: city === c ? "" : c })}
              className={`border-2 border-foreground px-3 py-1.5 text-sm font-medium transition-all ${
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
        <p className="mb-2 font-mono text-sm font-bold">Neighbourhood</p>
        <Input
          type="text"
          placeholder="e.g. Lekki, Victoria Island"
          value={area}
          onChange={(e) => updateParams({ area: e.target.value })}
          className="border-2 border-foreground bg-background"
        />
      </div>

      {/* Bedrooms */}
      <div>
        <p className="mb-2 font-mono text-sm font-bold">Bedrooms</p>
        <div className="flex flex-wrap gap-2">
          {BED_OPTIONS.map((beds) => (
            <button
              key={beds}
              onClick={() =>
                updateParams({
                  minBedrooms:
                    beds === "Any" ? "" : beds === "4+" ? "4" : beds,
                  maxBedrooms:
                    beds === "Any" ? "" : beds === "4+" ? "" : beds,
                })
              }
              className={`border-2 border-foreground px-3 py-1.5 text-sm font-medium transition-all ${
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
        <p className="mb-2 font-mono text-sm font-bold">Bathrooms</p>
        <div className="flex flex-wrap gap-2">
          {BATH_OPTIONS.map((baths) => (
            <button
              key={baths}
              onClick={() =>
                updateParams({
                  minBathrooms:
                    baths === "Any" ? "" : baths === "3+" ? "3" : baths,
                  maxBathrooms:
                    baths === "Any" ? "" : baths === "3+" ? "" : baths,
                })
              }
              className={`border-2 border-foreground px-3 py-1.5 text-sm font-medium transition-all ${
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
        <p className="mb-2 font-mono text-sm font-bold">Annual Rent (₦)</p>
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="Min"
            value={minAnnualRent}
            onChange={(e) => updateParams({ minAnnualRent: e.target.value })}
            className="border-2 border-foreground bg-background"
          />
          <span className="flex items-center text-muted-foreground">-</span>
          <Input
            type="number"
            placeholder="Max"
            value={maxAnnualRent}
            onChange={(e) => updateParams({ maxAnnualRent: e.target.value })}
            className="border-2 border-foreground bg-background"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main map page content
// ---------------------------------------------------------------------------

function MapPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [properties, setProperties] = useState<PropertyListing[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Read filter state from URL
  const city = searchParams.get("city") || "";
  const area = searchParams.get("area") || "";
  const minBedrooms = searchParams.get("minBedrooms") || "";
  const maxBedrooms = searchParams.get("maxBedrooms") || "";
  const minBathrooms = searchParams.get("minBathrooms") || "";
  const maxBathrooms = searchParams.get("maxBathrooms") || "";
  const minAnnualRent = searchParams.get("minAnnualRent") || "";
  const maxAnnualRent = searchParams.get("maxAnnualRent") || "";
  const sortBy = searchParams.get("sortBy") || "newest";

  const updateParams = (updates: Record<string, string>) => {
    const newParams = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (!value || value === "Any" || value === "newest") {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    router.push(`/properties/map?${newParams.toString()}`);
  };

  const clearAllFilters = () => {
    router.push("/properties/map");
  };

  const hasActiveFilters = Boolean(
    city ||
      area ||
      minBedrooms ||
      maxBedrooms ||
      minBathrooms ||
      maxBathrooms ||
      minAnnualRent ||
      maxAnnualRent,
  );

  const fetchProperties = useCallback(async () => {
    setIsLoading(true);
    try {
      const filters: PropertySearchFilters = {
        sortBy: (sortBy as PropertySearchFilters["sortBy"]) || "newest",
        pageSize: 200, // fetch a large batch for map display
        page: 1,
      };

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
    } catch (error) {
      console.error("Failed to fetch properties for map:", error);
      setProperties([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [
    city,
    area,
    minBedrooms,
    maxBedrooms,
    minBathrooms,
    maxBathrooms,
    minAnnualRent,
    maxAnnualRent,
    sortBy,
  ]);

  useEffect(() => {
    const timer = setTimeout(fetchProperties, 300);
    return () => clearTimeout(timer);
  }, [fetchProperties]);

  // Build query string that preserves current filters for the list-view link
  const listViewHref = `/properties${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

  const filterPanelProps: FilterPanelProps = {
    city,
    area,
    minBedrooms,
    maxBedrooms,
    minBathrooms,
    maxBathrooms,
    minAnnualRent,
    maxAnnualRent,
    updateParams,
    clearAllFilters,
  };

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Hero header */}
      <section className="shrink-0 border-b-3 border-foreground bg-muted py-6">
        <div className="container mx-auto px-4">
          <h1 className="font-mono text-2xl font-black md:text-3xl">
            Map <span className="text-primary">Property Search</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Explore properties on the map. Click a pin to see details.
          </p>
        </div>
      </section>

      {/* Content area: sidebar + map */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Desktop sidebar (hidden on mobile) */}
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-r-3 border-foreground bg-card md:block">
          <FilterPanel {...filterPanelProps} />
        </aside>

        {/* Map area */}
        <div className="relative flex-1">
          {/* Top toolbar overlaid on the map */}
          <div className="absolute left-0 right-0 top-0 z-400 flex items-center justify-between gap-2 border-b-2 border-foreground bg-background/90 px-3 py-2 backdrop-blur-sm">
            {/* Mobile: filter button (opens drawer) */}
            <div className="flex items-center gap-2 md:hidden">
              <Drawer direction="bottom">
                <DrawerTrigger asChild>
                  <Button
                    size="sm"
                    className="border-2 border-foreground bg-background font-bold text-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  >
                    <SlidersHorizontal className="mr-1 h-4 w-4" />
                    Filters
                    {hasActiveFilters && (
                      <span className="ml-1 flex h-5 w-5 items-center justify-center bg-primary text-xs font-black">
                        !
                      </span>
                    )}
                  </Button>
                </DrawerTrigger>
                <DrawerContent className="max-h-[80vh] overflow-y-auto border-t-3 border-foreground">
                  <DrawerHeader className="border-b-2 border-foreground pb-2">
                    <DrawerTitle className="font-mono font-black">
                      Filter Properties
                    </DrawerTitle>
                  </DrawerHeader>
                  <FilterPanel {...filterPanelProps} />
                  <div className="border-t-2 border-foreground p-4">
                    <DrawerClose asChild>
                      <Button className="w-full border-2 border-foreground bg-primary font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                        Apply Filters
                      </Button>
                    </DrawerClose>
                  </div>
                </DrawerContent>
              </Drawer>
            </div>

            {/* Property count badge */}
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              <Badge className="border-2 border-foreground bg-foreground font-mono text-xs font-black text-background">
                {isLoading ? "..." : `${total} properties`}
              </Badge>
              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  className="flex items-center gap-1 text-xs text-muted-foreground underline"
                >
                  <X className="h-3 w-3" />
                  Clear filters
                </button>
              )}
            </div>

            {/* List view link */}
            <Link href={listViewHref}>
              <Button
                size="sm"
                className="border-2 border-foreground bg-background font-bold text-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-none"
              >
                <List className="mr-1 h-4 w-4" />
                List View
              </Button>
            </Link>
          </div>

          {/* Map container — full height minus the toolbar */}
          <div className="absolute inset-0 top-12">
            {isLoading ? (
              <div className="flex h-full w-full items-center justify-center bg-muted">
                <p className="font-mono font-bold text-muted-foreground">
                  Loading properties...
                </p>
              </div>
            ) : (
              <PropertyMap
                properties={properties}
                center={LAGOS_CENTER}
                zoom={12}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background">
          <p className="font-mono font-bold text-muted-foreground">
            Loading map...
          </p>
        </div>
      }
    >
      <MapPageContent />
    </Suspense>
  );
}
