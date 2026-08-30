"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, X, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getProperty, type PropertyListing } from "@/lib/propertiesApi";
import {
  parseCompareIds,
  encodeCompareIds,
  MAX_COMPARE,
  MIN_COMPARE,
  canCompare,
  buildAmenityDiff,
  type AmenityRow,
} from "@/lib/compare";
import { formatNgn } from "@/lib/currency";
import { PROPERTY_AMENITY_LABELS, type PropertyAmenity } from "@/lib/amenities";
import { LandlordVerificationBadge } from "@/components/LandlordVerificationBadge";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface PropertyWithAmenities extends PropertyListing {
  amenities: PropertyAmenity[];
}

function CompareContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyWithAmenities[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ids = parseCompareIds(searchParams.get("ids"));

  useEffect(() => {
    if (ids.length === 0) {
      setLoading(false);
      return;
    }

    const fetchProperties = async () => {
      setLoading(true);
      setError(null);
      try {
        const results = await Promise.all(
          ids.map((id) => getProperty(id).catch((err) => null))
        );
        const validProperties = results
          .filter((r): r is NonNullable<typeof r> => r !== null && r.data !== undefined)
          .map((r) => ({
            ...r.data,
            amenities: (r.data as any).amenities || [],
          }));
        setProperties(validProperties);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load properties");
      } finally {
        setLoading(false);
      }
    };

    void fetchProperties();
  }, [ids]);

  const handleRemove = useCallback(
    (id: string) => {
      const newIds = ids.filter((i) => i !== id);
      const newParams = new URLSearchParams(searchParams.toString());
      if (newIds.length > 0) {
        newParams.set("ids", encodeCompareIds(newIds));
      } else {
        newParams.delete("ids");
      }
      router.push(`/properties/compare?${newParams.toString()}`);
    },
    [ids, searchParams, router]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="font-mono font-bold text-muted-foreground">Loading comparison...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="font-mono font-bold text-destructive mb-4">{error}</p>
          <Link href="/properties">
            <Button variant="outline">Back to Properties</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (ids.length < MIN_COMPARE) {
    return (
      <div className="min-h-screen bg-background">
        <main className="container mx-auto max-w-4xl px-4 pt-24 pb-12">
          <Link
            href="/properties"
            className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Properties
          </Link>
          <div className="border-3 border-foreground bg-muted p-12 text-center shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <Scale className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
            <h1 className="font-mono text-2xl font-black mb-2">Compare Properties</h1>
            <p className="text-muted-foreground mb-6">
              Select at least {MIN_COMPARE} properties to compare side-by-side.
            </p>
            <Link href="/properties">
              <Button className="border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                Browse Properties
              </Button>
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const amenityRows = buildAmenityDiff(properties);

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto max-w-7xl px-4 pt-24 pb-12">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/properties"
            className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Properties
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {properties.length} of {MAX_COMPARE} properties
            </span>
          </div>
        </div>

        <h1 className="mb-6 font-mono text-3xl font-black">Compare Properties</h1>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48 font-bold">Attribute</TableHead>
                {properties.map((property) => (
                  <TableHead key={property.listingId} className="min-w-64">
                    <div className="space-y-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(property.listingId)}
                        className="float-right"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Link
                        href={`/properties/${property.listingId}`}
                        className="font-mono font-bold hover:underline block"
                      >
                        {property.address}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {[property.area, property.city].filter(Boolean).join(", ")}
                      </p>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Price */}
              <TableRow>
                <TableCell className="font-bold">Annual Rent</TableCell>
                {properties.map((property) => (
                  <TableCell key={property.listingId}>
                    <span className="font-mono font-black text-lg">
                      {formatNgn(property.annualRentNgn)}
                    </span>
                  </TableCell>
                ))}
              </TableRow>

              {/* Monthly Payment */}
              <TableRow>
                <TableCell className="font-bold">Est. Monthly</TableCell>
                {properties.map((property) => (
                  <TableCell key={property.listingId}>
                    <span className="font-mono font-bold">
                      {formatNgn(Math.round(property.annualRentNgn / 12))}/mo
                    </span>
                  </TableCell>
                ))}
              </TableRow>

              {/* Bedrooms */}
              <TableRow>
                <TableCell className="font-bold">Bedrooms</TableCell>
                {properties.map((property) => (
                  <TableCell key={property.listingId}>{property.bedrooms}</TableCell>
                ))}
              </TableRow>

              {/* Bathrooms */}
              <TableRow>
                <TableCell className="font-bold">Bathrooms</TableCell>
                {properties.map((property) => (
                  <TableCell key={property.listingId}>{property.bathrooms}</TableCell>
                ))}
              </TableRow>

              {/* Location */}
              <TableRow>
                <TableCell className="font-bold">Location</TableCell>
                {properties.map((property) => (
                  <TableCell key={property.listingId}>
                    {[property.area, property.city].filter(Boolean).join(", ") || "Nigeria"}
                  </TableCell>
                ))}
              </TableRow>

              {/* Verification Status */}
              <TableRow>
                <TableCell className="font-bold">Verification</TableCell>
                {properties.map((property) => (
                  <TableCell key={property.listingId}>
                    <div className="flex flex-wrap gap-2">
                      {property.hasApprovedInspection && (
                        <div className="flex items-center gap-1 text-sm">
                          <ShieldCheck className="h-4 w-4" />
                          <span>Inspection Verified</span>
                        </div>
                      )}
                      <LandlordVerificationBadge
                        level={(property as any).landlordVerificationLevel || "unverified"}
                        size="sm"
                      />
                    </div>
                  </TableCell>
                ))}
              </TableRow>

              {/* Amenities */}
              {amenityRows.map((row) => (
                <TableRow
                  key={row.amenity}
                  className={cn(row.differs && "bg-primary/5")}
                >
                  <TableCell className="font-bold">
                    {PROPERTY_AMENITY_LABELS[row.amenity as PropertyAmenity] || row.amenity}
                  </TableCell>
                  {row.availability.map((available, idx) => (
                    <TableCell key={properties[idx].listingId}>
                      {available ? (
                        <span className="text-green-600 font-bold">✓</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="mt-6 flex justify-center gap-4">
          <Link href="/properties">
            <Button variant="outline">Add More Properties</Button>
          </Link>
        </div>
      </main>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="font-mono font-bold text-muted-foreground">Loading comparison...</p>
      </div>
    }>
      <CompareContent />
    </Suspense>
  );
}
