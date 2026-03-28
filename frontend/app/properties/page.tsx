"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Heart,
  MapPin,
  Bed,
  Bath,
  Square,
  Search,
  SlidersHorizontal,
  Home,
  SearchX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { allProperties, propertyFilters } from "@/lib/mockData";

const properties = allProperties;
const locations = propertyFilters.locations;
const priceRanges = propertyFilters.priceRanges;
const bedOptions = propertyFilters.bedOptions;

export default function PropertiesPage() {
  const [favorites, setFavorites] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("All Locations");
  const [selectedPrice, setSelectedPrice] = useState("Any Price");
  const [selectedBeds, setSelectedBeds] = useState("Any");
  const [showFilters, setShowFilters] = useState(false);

  const toggleFavorite = (id: number) => {
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((fid) => fid !== id) : [...prev, id],
    );
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(price);
  };

  const filteredProperties = properties.filter((property) => {
    const matchesSearch =
      property.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      property.location.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesLocation =
      selectedLocation === "All Locations" ||
      property.location.includes(selectedLocation);

    let matchesPrice = true;
    if (selectedPrice === "Under ₦2M") matchesPrice = property.price < 2000000;
    else if (selectedPrice === "₦2M - ₦5M")
      matchesPrice = property.price >= 2000000 && property.price <= 5000000;
    else if (selectedPrice === "₦5M - ₦10M")
      matchesPrice = property.price > 5000000 && property.price <= 10000000;
    else if (selectedPrice === "Above ₦10M")
      matchesPrice = property.price > 10000000;

    let matchesBeds = true;
    if (selectedBeds !== "Any") {
      if (selectedBeds === "4+") matchesBeds = property.beds >= 4;
      else matchesBeds = property.beds === Number.parseInt(selectedBeds);
    }

    return matchesSearch && matchesLocation && matchesPrice && matchesBeds;
  });

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
                className="border-3 border-foreground bg-background pl-12 py-6 font-medium shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              />
            </div>

            <Button
              onClick={() => setShowFilters(!showFilters)}
              className="border-3 border-foreground bg-background px-6 py-6 font-bold text-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] md:w-auto"
            >
              <SlidersHorizontal className="mr-2 h-5 w-5" />
              Filters
              {(selectedLocation !== "All Locations" ||
                selectedPrice !== "Any Price" ||
                selectedBeds !== "Any") && (
                <span className="ml-2 flex h-6 w-6 items-center justify-center bg-primary text-xs font-bold">
                  {
                    [
                      selectedLocation !== "All Locations",
                      selectedPrice !== "Any Price",
                      selectedBeds !== "Any",
                    ].filter(Boolean).length
                  }
                </span>
              )}
            </Button>
          </div>

          {/* Filter Options */}
          {showFilters && (
            <div className="mt-6 border-3 border-foreground bg-background p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-mono text-lg font-bold">
                  Filter Properties
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedLocation("All Locations");
                    setSelectedPrice("Any Price");
                    setSelectedBeds("Any");
                  }}
                  className="text-sm underline"
                >
                  Clear All
                </Button>
              </div>

              <div className="grid gap-6 md:grid-cols-3">
                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    Location
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {locations.map((loc) => (
                      <button
                        key={loc}
                        onClick={() => setSelectedLocation(loc)}
                        className={`border-2 border-foreground px-3 py-2 text-sm font-medium transition-all ${
                          selectedLocation === loc
                            ? "bg-foreground text-background"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {loc}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    Price Range (Annual)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {priceRanges.map((range) => (
                      <button
                        key={range}
                        onClick={() => setSelectedPrice(range)}
                        className={`border-2 border-foreground px-3 py-2 text-sm font-medium transition-all ${
                          selectedPrice === range
                            ? "bg-foreground text-background"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {range}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    Bedrooms
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {bedOptions.map((beds) => (
                      <button
                        key={beds}
                        onClick={() => setSelectedBeds(beds)}
                        className={`border-2 border-foreground px-4 py-2 text-sm font-medium transition-all ${
                          selectedBeds === beds
                            ? "bg-foreground text-background"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {beds}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
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
              <span className="font-bold text-foreground">
                {filteredProperties.length}
              </span>{" "}
              properties
            </p>
          </div>

          {filteredProperties.length === 0 ? (
            <div className="border-3 border-foreground bg-muted p-12 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <SearchX className="mx-auto h-16 w-16 text-muted-foreground" />
              <p className="font-mono text-xl font-bold mb-2 mt-4">
                No properties found
              </p>
              <p className="text-muted-foreground">
                Try adjusting your filters or search query.
              </p>
              <Button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedLocation("All Locations");
                  setSelectedPrice("Any Price");
                  setSelectedBeds("Any");
                }}
                className="mt-6 border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                Clear Filters
              </Button>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredProperties.map((property) => (
                <div
                  key={property.id}
                  className="group border-3 border-foreground bg-card shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  <div className="relative aspect-4/3 border-b-3 border-foreground bg-muted">
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <Home className="h-12 w-12" />
                    </div>
                    {property.tag && (
                      <span
                        className={`absolute left-3 top-3 border-2 border-foreground ${property.tagColor} px-2 py-1 text-xs font-bold`}
                      >
                        {property.tag}
                      </span>
                    )}
                    <button
                      onClick={() => toggleFavorite(property.id)}
                      className={`absolute right-3 top-3 flex h-10 w-10 items-center justify-center border-2 border-foreground bg-background transition-colors ${
                        favorites.includes(property.id)
                          ? "text-destructive"
                          : ""
                      }`}
                    >
                      <Heart
                        className={`h-5 w-5 ${favorites.includes(property.id) ? "fill-current" : ""}`}
                      />
                    </button>
                  </div>

                  <div className="p-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h3 className="font-mono text-lg font-bold leading-tight">
                        {property.title}
                      </h3>
                    </div>

                    <div className="mb-3 flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      <span>{property.location}</span>
                    </div>

                    <div className="mb-4 flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Bed className="h-4 w-4" />
                        {property.beds}
                      </span>
                      <span className="flex items-center gap-1">
                        <Bath className="h-4 w-4" />
                        {property.baths}
                      </span>
                      <span className="flex items-center gap-1">
                        <Square className="h-4 w-4" />
                        {property.sqm}m²
                      </span>
                    </div>

                    {/* Whistleblower Info */}
                    {property.whistleblower && (
                      <div className="mb-3 bg-secondary/20 border-2 border-secondary px-3 py-2">
                        <p className="text-xs font-bold text-secondary mb-1">
                          Reported by Resident
                        </p>
                        <p className="text-sm font-bold">
                          {property.whistleblower.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {property.whistleblower.rating}⭐ (
                          {property.whistleblower.reviews} reviews)
                        </p>
                      </div>
                    )}

                    <div className="border-t-2 border-dashed border-foreground/30 pt-4">
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Annual Rent
                          </p>
                          <p className="font-mono text-xl font-black">
                            {formatPrice(property.price)}
                          </p>
                        </div>
                        <Link href={`/properties/${property.id}`}>
                          <Button className="border-2 border-foreground bg-primary px-4 py-2 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)]">
                            View
                          </Button>
                        </Link>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        From{" "}
                        <span className="font-bold text-primary">
                          {formatPrice(Math.round(property.price / 12))}/mo
                        </span>{" "}
                        with Sheltaflex
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
