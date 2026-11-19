"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Bath,
  Bed,
  ChevronLeft,
  ChevronRight,
  Heart,
  Home,
  MapPin,
  ShieldCheck,
  Scale,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MoneyValue } from "@/components/ui/data-state";
import { LandlordVerificationBadge } from "@/components/LandlordVerificationBadge";
import { showErrorToast } from "@/lib/toast";
import { formatNgn } from "@/lib/currency";
import {
  addToCompare,
  removeFromCompare,
  encodeCompareIds,
  parseCompareIds,
  MAX_COMPARE,
  type AddResult,
} from "@/lib/compare";

export type PropertyCardPaymentType = "outright" | "installment";

export interface PropertyCardData {
  listingId: string;
  address: string;
  city?: string;
  area?: string;
  bedrooms: number;
  bathrooms: number;
  annualRentNgn: number;
  outrightPriceNgn?: number;
  installmentBasePriceNgn?: number;
  paymentType?: PropertyCardPaymentType;
  installmentPlanMonths?: number;
  photos?: string[];
  hasApprovedInspection?: boolean;
  landlordVerificationLevel?:
    | 'unverified'
    | 'id_verified'
    | 'id_and_property_verified'
    | 'premium';
}

export interface PropertyCardProps {
  property: PropertyCardData;
  variant?: "grid" | "horizontal";
  href?: string;
  showFavorite?: boolean;
  isFavorited?: boolean;
  onFavoriteChange?: (saved: boolean) => void | Promise<void>;
  /** Shown over the carousel (e.g. landlord status badge). */
  imageOverlay?: ReactNode;
  /** Extra content below price row (landlord actions, etc.). */
  children?: ReactNode;
  className?: string;
  /** Show compare button on the card */
  showCompare?: boolean;
}

const DEFAULT_PLAN_MONTHS = 12;

function formatLocation(property: PropertyCardData) {
  const parts = [property.area, property.city].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Nigeria";
}

function propertyAccessibleName(property: PropertyCardData) {
  return `${property.address}, ${formatLocation(property)}`;
}

function resolvePaymentType(property: PropertyCardData): PropertyCardPaymentType {
  if (property.paymentType) {
    return property.paymentType;
  }
  if (property.outrightPriceNgn && !property.installmentBasePriceNgn) {
    return "outright";
  }
  return "installment";
}

function getCarouselImages(property: PropertyCardData): string[] {
  if (property.photos && property.photos.length > 0) {
    return property.photos;
  }
  return [];
}

function imageAltText(property: PropertyCardData, index: number, total: number) {
  const name = propertyAccessibleName(property);
  if (total <= 1) {
    return `Photo of ${name}`;
  }
  return `Photo ${index + 1} of ${total} for ${name}`;
}

interface PropertyImageCarouselProps {
  property: PropertyCardData;
  overlay?: ReactNode;
  className?: string;
}

export function PropertyImageCarousel({
  property,
  overlay,
  className,
}: PropertyImageCarouselProps) {
  const images = getCarouselImages(property);
  const slideCount = Math.max(images.length, 1);
  const propertyName = propertyAccessibleName(property);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const carouselId = useId();

  const scrollToIndex = useCallback((index: number) => {
    const container = scrollRef.current;
    if (!container) return;
    const clamped = Math.max(0, Math.min(index, slideCount - 1));
    const slideWidth = container.clientWidth;
    container.scrollTo({ left: slideWidth * clamped, behavior: "smooth" });
    setActiveIndex(clamped);
  }, [slideCount]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container || container.clientWidth === 0) return;
    const index = Math.round(container.scrollLeft / container.clientWidth);
    setActiveIndex(Math.max(0, Math.min(index, slideCount - 1)));
  }, [slideCount]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      scrollToIndex(activeIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      scrollToIndex(activeIndex + 1);
    }
  };

  const showControls = slideCount > 1;

  return (
    <div
      className={cn(
        "relative aspect-4/3 overflow-hidden border-foreground bg-muted",
        className,
      )}
    >
      <div
        id={carouselId}
        ref={scrollRef}
        role="region"
        aria-roledescription="carousel"
        aria-label={`Photos for ${propertyName}`}
        tabIndex={showControls ? 0 : -1}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        className={cn(
          "flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "touch-pan-x",
        )}
      >
        {images.length > 0 ? (
          images.map((src, index) => (
            <div
              key={`${src}-${index}`}
              className="relative h-full w-full shrink-0 snap-center snap-always"
              role="group"
              aria-roledescription="slide"
              aria-label={`Photo ${index + 1} of ${slideCount}`}
            >
              <Image
                src={src}
                alt={imageAltText(property, index, slideCount)}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                className="object-cover"
              />
            </div>
          ))
        ) : (
          <div
            className="flex h-full w-full shrink-0 snap-center items-center justify-center text-muted-foreground"
            role="img"
            aria-label={`No photos available for ${propertyName}`}
          >
            <Home className="h-12 w-12" aria-hidden />
          </div>
        )}
      </div>

      {overlay}

      {showControls && (
        <>
          <button
            type="button"
            aria-label={`Previous photo of ${propertyName}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              scrollToIndex(activeIndex - 1);
            }}
            disabled={activeIndex === 0}
            className="absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center border-2 border-foreground bg-background/90 disabled:opacity-40"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Next photo of ${propertyName}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              scrollToIndex(activeIndex + 1);
            }}
            disabled={activeIndex >= slideCount - 1}
            className="absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center border-2 border-foreground bg-background/90 disabled:opacity-40"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
          <div
            className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 gap-1.5"
            aria-live="polite"
          >
            {images.map((_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Go to photo ${index + 1} of ${propertyName}`}
                aria-current={index === activeIndex ? "true" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  scrollToIndex(index);
                }}
                className={cn(
                  "h-2 w-2 border border-foreground transition-colors",
                  index === activeIndex ? "bg-primary" : "bg-background/80",
                )}
              />
            ))}
          </div>
          <span className="sr-only">
            Photo {activeIndex + 1} of {slideCount}
          </span>
        </>
      )}
    </div>
  );
}

export function PropertyCard({
  property,
  variant = "grid",
  href,
  showFavorite = false,
  isFavorited = false,
  onFavoriteChange,
  imageOverlay,
  children,
  className,
  showCompare = false,
}: PropertyCardProps) {
  const [favorited, setFavorited] = useState(isFavorited);
  const [favoritePending, setFavoritePending] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  const compareIds = parseCompareIds(searchParams.get("ids"));
  const isComparing = compareIds.includes(property.listingId);

  useEffect(() => {
    setFavorited(isFavorited);
  }, [isFavorited]);

  const paymentType = resolvePaymentType(property);
  const planMonths = property.installmentPlanMonths ?? DEFAULT_PLAN_MONTHS;
  const locationLabel = formatLocation(property);
  const propertyName = propertyAccessibleName(property);
  const detailHref = href ?? `/properties/${property.listingId}`;

  const showBothPrices =
    property.outrightPriceNgn && property.installmentBasePriceNgn;

  const priceBlock = showBothPrices ? (
    <>
      <p className="text-xs text-muted-foreground">
        <MoneyValue
          status="ready"
          amount={property.installmentBasePriceNgn}
          format={formatNgn}
          skeletonClassName="h-3 w-20"
          unavailableLabel="Installment price unavailable"
        />
        /yr (installment)
      </p>
      <p className="font-mono text-xl font-black">
        <MoneyValue
          status="ready"
          amount={property.outrightPriceNgn}
          format={formatNgn}
          unavailableLabel="Outright price unavailable"
        />{" "}
        <span className="text-xs font-medium text-muted-foreground">outright</span>
      </p>
    </>
  ) : paymentType === "outright" ? (
    <>
      <p className="text-xs text-muted-foreground">Price</p>
      <p className="font-mono text-xl font-black">
        {formatNgn(property.outrightPriceNgn ?? property.annualRentNgn)}
      </p>
    </>
  ) : (
    <>
      <p className="text-xs text-muted-foreground">Est. monthly</p>
      <p className="font-mono text-xl font-black">
        {formatNgn(
          Math.round(
            (property.installmentBasePriceNgn ?? property.annualRentNgn) /
              planMonths,
          ),
        )}
        <span className="text-sm font-medium text-muted-foreground">/mo</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {formatNgn(property.annualRentNgn)} annual · {planMonths}-mo plan
      </p>
    </>
  );

  const handleFavoriteClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (favoritePending) return;

    const next = !favorited;
    setFavorited(next);
    setFavoritePending(true);

    try {
      await onFavoriteChange?.(next);
    } catch (error) {
      setFavorited(!next);
      showErrorToast(error, "Could not update saved property");
    } finally {
      setFavoritePending(false);
    }
  };

  const handleCompareClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const result: AddResult = isComparing
      ? { ids: removeFromCompare(compareIds, property.listingId), added: false }
      : addToCompare(compareIds, property.listingId);

    if (result.error === "full") {
      showErrorToast(new Error(`You can compare up to ${MAX_COMPARE} properties`), "Compare limit reached");
      return;
    }

    const newParams = new URLSearchParams(searchParams.toString());
    if (result.ids.length > 0) {
      newParams.set("ids", encodeCompareIds(result.ids));
    } else {
      newParams.delete("ids");
    }
    router.push(`/properties?${newParams.toString()}`);
  };

  const favoriteButton = showFavorite ? (
    <button
      type="button"
      aria-label={
        favorited ? `Saved: ${propertyName}` : `Save property: ${propertyName}`
      }
      aria-pressed={favorited}
      disabled={favoritePending}
      onClick={handleFavoriteClick}
      className={cn(
        "absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center border-2 border-foreground bg-background transition-colors",
        favorited && "text-destructive",
      )}
    >
      <Heart
        className={cn("h-5 w-5", favorited && "fill-current")}
        aria-hidden
      />
    </button>
  ) : null;

  const overlay = (
    <>
      {property.landlordVerificationLevel && (
        <div className="absolute left-3 top-3 z-20">
          <LandlordVerificationBadge
            level={property.landlordVerificationLevel}
            size="sm"
          />
        </div>
      )}
      {showCompare && (
        <button
          type="button"
          aria-label={
            isComparing
              ? `Remove from comparison: ${propertyName}`
              : `Add to comparison: ${propertyName}`
          }
          aria-pressed={isComparing}
          onClick={handleCompareClick}
          className={cn(
            "absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center border-2 border-foreground bg-background transition-colors",
            isComparing && "text-primary",
          )}
        >
          <Scale
            className={cn("h-5 w-5", isComparing && "fill-current")}
            aria-hidden
          />
        </button>
      )}
      {imageOverlay}
    </>
  );

  const badges = (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Badge
        variant="secondary"
        className="border-2 border-foreground font-bold capitalize"
      >
        {paymentType === "outright" ? "Outright" : "Installment"}
      </Badge>
      {property.hasApprovedInspection && (
        <Badge className="gap-1 border-2 border-foreground bg-secondary font-bold">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Verified inspection
        </Badge>
      )}
    </div>
  );

  const bodyContent = (
    <>
      {badges}
      <h3 className="font-mono text-lg font-bold leading-tight">
        {property.address}
      </h3>
      <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
        <MapPin className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{locationLabel}</span>
      </div>
      <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Bed className="h-4 w-4" aria-hidden />
          {property.bedrooms}
        </span>
        <span className="flex items-center gap-1">
          <Bath className="h-4 w-4" aria-hidden />
          {property.bathrooms}
        </span>
      </div>
      <div className="mt-4 border-t-2 border-dashed border-foreground/30 pt-4">
        <div className="flex items-end justify-between gap-2">
          <div>{priceBlock}</div>
          {variant === "grid" && (
            <Link
              href={detailHref}
              aria-label={`View details for ${propertyName}`}
            >
              <Button className="border-2 border-foreground bg-primary px-4 py-2 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0px_0px_rgba(26,26,26,1)]">
                View
              </Button>
            </Link>
          )}
        </div>
      </div>
      {children}
    </>
  );

  if (variant === "horizontal") {
    return (
      <article
        className={cn(
          "group border-3 border-foreground bg-card shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]",
          className,
        )}
      >
        <div className="flex">
          <div className="relative w-72 shrink-0 border-r-3 border-foreground">
            <PropertyImageCarousel
              property={property}
              overlay={overlay}
              className="aspect-auto h-48 w-full border-0"
            />
            {favoriteButton}
          </div>
          <div className="flex min-w-0 flex-1 flex-col p-6">{bodyContent}</div>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "group border-3 border-foreground bg-card shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]",
        className,
      )}
    >
      <div className="relative border-b-3 border-foreground">
        <PropertyImageCarousel property={property} overlay={overlay} />
        {favoriteButton}
      </div>
      <div className="p-4">{bodyContent}</div>
    </article>
  );
}

/** Map search API listing to card props. */
export function propertyListingToCard(
  listing: {
    listingId: string;
    address: string;
    city?: string;
    area?: string;
    bedrooms: number;
    bathrooms: number;
    annualRentNgn: number;
    outrightPriceNgn?: number;
    installmentBasePriceNgn?: number;
    photos?: string[];
    hasApprovedInspection?: boolean;
  },
): PropertyCardData {
  return {
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
  };
}
