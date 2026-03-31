"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Heart,
  MapPin,
  Bed,
  Bath,
  Square,
  ArrowLeft,
  Share2,
  Wifi,
  Car,
  Shield,
  Dumbbell,
  TreePine,
  Wind,
  Utensils,
  Tv,
  Waves,
  ChevronLeft,
  ChevronRight,
  X,
  Calculator,
  Home,
  MessageSquare,
  Star,
  CheckCircle,
  Flag,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { allProperties } from "@/lib/mockData/properties";
import { AmenitiesLegend } from "@/components/properties/AmenitiesLegend";
import { showSuccessToast, showErrorToast } from "@/lib/toast";

const properties = allProperties;

const featureIcons: { [key: string]: React.ElementType } = {
  "24/7 Power Supply": Wind,
  "24/7 Power": Wind,
  "Fully Fitted Kitchen": Utensils,
  "Modern Kitchen": Utensils,
  "Gourmet Kitchen": Utensils,
  "Air Conditioning": Wind,
  "Swimming Pool": Waves,
  "Infinity Pool": Waves,
  "Gym Access": Dumbbell,
  "Gym & Spa": Dumbbell,
  "Secure Parking": Car,
  "Spacious Parking": Car,
  "Underground Parking": Car,
  "Parking Space": Car,
  "Double Garage": Car,
  Garage: Car,
  "CCTV Security": Shield,
  "24/7 Security": Shield,
  "Security Gate": Shield,
  "Fiber Internet Ready": Wifi,
  "Smart Home System": Wifi,
  "Smart Home": Wifi,
  "Private Garden": TreePine,
  "Garden Space": TreePine,
  Backyard: TreePine,
  "Home Cinema": Tv,
  "Private Cinema": Tv,
  Balcony: TreePine,
  "Rooftop Lounge": TreePine,
};

type PropertyDetailClientProps = {
  propertyId: string;
};

export default function PropertyDetailClient({
  propertyId,
}: PropertyDetailClientProps) {
  const router = useRouter();
  const [isFavorite, setIsFavorite] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showLightbox, setShowLightbox] = useState(false);
  const [paymentMonths, setPaymentMonths] = useState(12);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportCategory, setReportCategory] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSubmitted, setReportSubmitted] = useState(false);

  const property = properties.find((p) => p.id === Number.parseInt(propertyId));

  if (!property) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="border-3 border-foreground bg-card p-12 text-center shadow-[6px_6px_0px_0px_rgba(26,26,26,1)]">
          <Home className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
          <h1 className="font-mono text-2xl font-black mb-2">
            Property Not Found
          </h1>
          <p className="text-muted-foreground mb-6">
            The property you're looking for doesn't exist.
          </p>
          <Link href="/properties">
            <Button className="border-3 border-foreground bg-primary px-6 py-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              Browse Properties
            </Button>
          </Link>
        </div>
      </main>
    );
  }

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(price);
  };

  const minDeposit = property.price * 0.2; // 20% minimum deposit
  const amountToFinance = property.price - minDeposit;
  const inspectionFee = amountToFinance * 0.075;
  const monthlyPayment = Math.round(
    (amountToFinance + inspectionFee) / paymentMonths,
  );

  const nextImage = () => {
    setActiveImageIndex((prev) => (prev + 1) % property.images.length);
  };

  const prevImage = () => {
    setActiveImageIndex(
      (prev) => (prev - 1 + property.images.length) % property.images.length,
    );
  };

  const handleReportSubmit = () => {
    if (!reportCategory || !reportDetails.trim()) return;

    // Stub: In production, this would send to backend
    console.log("Report submitted:", {
      propertyId,
      reportCategory,
      reportDetails,
    });

    setReportSubmitted(true);
    setTimeout(() => {
      setShowReportDialog(false);
      setReportSubmitted(false);
      setReportCategory("");
      setReportDetails("");
    }, 2000);
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      showSuccessToast("Link copied to clipboard!");
    } catch (error) {
      showErrorToast(error, "Failed to copy link. Please try again.");
    }
  };

  return (
    <main className="min-h-screen bg-background">
      {/* Back Navigation */}
      <div className="border-b-3 border-foreground bg-muted">
        <div className="container mx-auto px-4 py-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 font-mono font-bold text-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to listings
          </button>
        </div>
      </div>

      {/* Image Gallery */}
      <section className="border-b-3 border-foreground">
        <div className="container mx-auto px-4 py-8">
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Main Image */}
            <div className="lg:col-span-2">
              <div className="relative aspect-16/10 w-full border-3 border-foreground bg-muted shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] overflow-hidden group">
                <button
                  type="button"
                  aria-label="Open image gallery"
                  aria-haspopup="dialog"
                  className="absolute inset-0 z-10"
                  onClick={() => setShowLightbox(true)}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                  {(() => {
                    const image = property.images[activeImageIndex];
                    // Try to render image if URL exists, otherwise show placeholder
                    return (
                      <div className="w-full h-full flex items-center justify-center bg-muted">
                        {image.url ? (
                          <Image
                            src={image.url}
                            alt={image.label}
                            fill
                            className="object-cover"
                            onError={(e) => {
                              // Fallback to placeholder if image fails to load
                              (e.target as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        ) : null}
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-muted/50">
                          <span className="font-mono text-xl font-bold">
                            {image.label}
                          </span>
                          <span className="text-sm mt-2">Click to expand</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {property.tag && (
                  <span
                    className={`absolute left-4 top-4 border-3 border-foreground ${property.tagColor} px-3 py-1 text-sm font-bold`}
                  >
                    {property.tag}
                  </span>
                )}

                {/* Navigation Arrows */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    prevImage();
                  }}
                  className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex h-12 w-12 items-center justify-center border-3 border-foreground bg-background shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    nextImage();
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex h-12 w-12 items-center justify-center border-3 border-foreground bg-background shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>

                {/* Image Counter */}
                <div className="absolute bottom-4 right-4 z-20 border-2 border-foreground bg-background px-3 py-1 font-mono text-sm font-bold">
                  {activeImageIndex + 1} / {property.images.length}
                </div>
              </div>
            </div>

            {/* Thumbnail Grid */}
            <div className="grid grid-cols-3 gap-2 md:gap-3 lg:grid-cols-2">
              {property.images.slice(0, 6).map((image, index) => {
                return (
                  <button
                    key={image.id}
                    onClick={() => setActiveImageIndex(index)}
                    className={`relative aspect-square border-3 border-foreground bg-muted transition-all overflow-hidden ${
                      activeImageIndex === index
                        ? "shadow-[4px_4px_0px_0px_rgba(255,107,53,1)] ring-2 ring-primary"
                        : "shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-px hover:translate-y-px"
                    }`}
                  >
                    {image.url ? (
                      <Image
                        src={image.url}
                        alt={image.label}
                        fill
                        className="object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground p-2 bg-muted/50">
                      <span className="text-xs font-bold text-center leading-tight">
                        {image.label}
                      </span>
                    </div>
                  </button>
                );
              })}
              {property.images.length > 6 && (
                <button
                  onClick={() => setShowLightbox(true)}
                  className="relative aspect-square border-3 border-foreground bg-foreground text-background shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-px hover:translate-y-px transition-all"
                >
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono text-2xl font-black">
                      +{property.images.length - 6}
                    </span>
                    <span className="text-xs font-bold">More</span>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Property Details */}
      <section className="py-8">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 lg:grid-cols-3">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-8">
              {/* Title & Location */}
              <div>
                <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <h1 className="font-mono text-2xl font-black md:text-3xl lg:text-4xl">
                    {property.title}
                  </h1>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsFavorite(!isFavorite)}
                      className={`flex h-10 w-10 items-center justify-center border-3 border-foreground bg-background shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] sm:h-12 sm:w-12 ${
                        isFavorite ? "text-destructive" : ""
                      }`}
                    >
                      <Heart
                        className={`h-4 w-4 sm:h-5 sm:w-5 ${isFavorite ? "fill-current" : ""}`}
                      />
                    </button>
                    <button
                      onClick={handleShare}
                      className="flex h-10 w-10 items-center justify-center border-3 border-foreground bg-background shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] sm:h-12 sm:w-12"
                    >
                      <Share2 className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground mb-4">
                  <MapPin className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
                  <span className="text-sm sm:text-base lg:text-lg">
                    {property.address}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 sm:gap-4">
                  <div className="flex items-center gap-1 border-2 border-foreground bg-muted px-2 py-1 sm:gap-2 sm:px-4 sm:py-2">
                    <Bed className="h-4 w-4 sm:h-5 sm:w-5" />
                    <span className="text-sm font-bold sm:text-base">
                      {property.beds} Beds
                    </span>
                  </div>
                  <div className="flex items-center gap-1 border-2 border-foreground bg-muted px-2 py-1 sm:gap-2 sm:px-4 sm:py-2">
                    <Bath className="h-4 w-4 sm:h-5 sm:w-5" />
                    <span className="text-sm font-bold sm:text-base">
                      {property.baths} Baths
                    </span>
                  </div>
                  <div className="flex items-center gap-1 border-2 border-foreground bg-muted px-2 py-1 sm:gap-2 sm:px-4 sm:py-2">
                    <Square className="h-4 w-4 sm:h-5 sm:w-5" />
                    <span className="text-sm font-bold sm:text-base">
                      {property.sqm} m²
                    </span>
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] sm:p-6">
                <h2 className="font-mono text-lg font-bold mb-3 sm:text-xl sm:mb-4">
                  About This Property
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed sm:text-base">
                  {property.description}
                </p>
              </div>

              {/* Features */}
              <div className="border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] sm:p-6">
                <h2 className="font-mono text-lg font-bold mb-3 sm:text-xl sm:mb-4">
                  Features & Amenities
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {property.features.map((feature, index) => {
                    const IconComponent = featureIcons[feature] || Check;
                    return (
                      <div
                        key={`${feature}-${index}`}
                        className="flex items-center gap-3 border-2 border-foreground bg-muted p-3"
                        role="listitem"
                        aria-label={`${feature} amenity`}
                      >
                        <div className="flex h-8 w-8 items-center justify-center bg-secondary border-2 border-foreground">
                          <IconComponent
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                        </div>
                        <span className="font-medium">{feature}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Amenities Legend */}
              <AmenitiesLegend />

              {/* Room Gallery */}
              <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h2 className="font-mono text-xl font-bold mb-4">
                  Property Gallery
                </h2>
                <p className="text-muted-foreground mb-4">
                  Click on any room to view full size
                </p>
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                  {property.images.map((image, index) => {
                    return (
                      <button
                        key={image.id}
                        onClick={() => {
                          setActiveImageIndex(index);
                          setShowLightbox(true);
                        }}
                        className="group relative aspect-4/3 border-3 border-foreground bg-muted shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] overflow-hidden"
                      >
                        {image.url ? (
                          <Image
                            src={image.url}
                            alt={image.label}
                            fill
                            className="object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        ) : null}
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors bg-muted/50">
                          <span className="font-mono font-bold">
                            {image.label}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Sidebar - Pricing & CTA */}
            <div className="lg:col-span-1">
              <div className="sticky top-24 space-y-6">
                {/* Pricing Card */}
                <div className="border-3 border-foreground bg-card p-4 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] sm:p-6">
                  <div className="mb-4">
                    <p className="text-xs text-muted-foreground sm:text-sm">
                      Annual Rent
                    </p>
                    <p className="font-mono text-2xl font-black sm:text-3xl">
                      {formatPrice(property.price)}
                    </p>
                  </div>

                  <div className="border-t-3 border-dashed border-foreground/30 pt-4 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Calculator className="h-5 w-5 text-primary" />
                      <span className="font-mono font-bold">
                        Pay with Shelterflex
                      </span>
                    </div>

                    <div className="mb-4">
                      <p className="block text-sm font-medium mb-2">
                        Payment Duration
                      </p>
                      <div className="flex gap-2">
                        {[3, 6, 12].map((months) => (
                          <button
                            key={months}
                            onClick={() => setPaymentMonths(months)}
                            className={`flex-1 border-2 border-foreground py-2 text-sm font-bold transition-all ${
                              paymentMonths === months
                                ? "bg-primary text-foreground"
                                : "bg-background hover:bg-muted"
                            }`}
                          >
                            {months}mo
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="border-3 border-primary bg-primary/10 p-4">
                      <p className="text-sm text-muted-foreground">
                        Monthly Payment
                      </p>
                      <p className="font-mono text-2xl font-black text-primary">
                        {formatPrice(monthlyPayment)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        for {paymentMonths} months (after 20% deposit)
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        *excludes inspection fee & other charges
                      </p>
                    </div>
                  </div>

                  <Link href={`/calculator?amount=${property.price}`}>
                    <Button className="w-full border-3 border-foreground bg-primary py-6 font-mono text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                      Apply Now
                    </Button>
                  </Link>

                  <p className="text-center text-xs text-muted-foreground mt-3">
                    Get instant approval in minutes
                  </p>
                </div>

                {/* Whistleblower Info */}
                {property.whistleblower && (
                  <div className="border-3 border-secondary bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-mono font-bold">
                        Reported by Resident
                      </h3>
                      <span className="inline-flex items-center gap-1 border-2 border-secondary bg-secondary/20 px-2 py-1 text-xs font-bold text-secondary">
                        <CheckCircle className="h-3 w-3" /> Verified
                      </span>
                    </div>

                    <div className="mb-4">
                      <p className="text-lg font-bold">
                        {property.whistleblower.name}
                      </p>
                      <div className="flex items-center gap-1 mt-1">
                        <Star className="h-4 w-4 fill-secondary text-secondary" />
                        <span className="font-bold">
                          {property.whistleblower.rating}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({property.whistleblower.reviews} reviews)
                        </span>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground mb-4">
                      {property.whistleblower.bio}
                    </p>

                    <div className="bg-secondary/10 border-2 border-secondary p-3 rounded-sm">
                      <p className="text-xs font-bold text-secondary mb-1">
                        Why this matters:
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Get authentic information from someone who actually
                        lives in the building. Ask questions and get honest
                        answers about neighborhood life.
                      </p>
                    </div>

                    <Link href="/messages">
                      <Button className="w-full mt-4 border-3 border-secondary bg-secondary py-5 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                        <MessageSquare className="mr-2 h-5 w-5" />
                        Message {property.whistleblower.name}
                      </Button>
                    </Link>
                  </div>
                )}

                {/* Landlord Info */}
                <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <h3 className="font-mono font-bold mb-4">Listed By</h3>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex h-12 w-12 items-center justify-center border-2 border-foreground bg-muted font-mono font-bold">
                      {property.landlord.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold">{property.landlord.name}</p>
                      <span
                        className={`mt-1 inline-flex items-center gap-1 border px-2 py-0.5 text-xs font-bold ${
                          property.landlord.verified
                            ? "border-secondary bg-secondary/15 text-secondary"
                            : "border-muted-foreground/40 bg-muted text-muted-foreground"
                        }`}
                      >
                        {property.landlord.verified ? (
                          <>
                            <CheckCircle className="h-3 w-3" /> Verified
                            Landlord
                          </>
                        ) : (
                          "Verification pending"
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p className="flex justify-between">
                      <span className="text-muted-foreground">
                        Active Listings
                      </span>
                      <span className="font-bold">
                        {property.landlord.listings}
                      </span>
                    </p>
                    <p className="flex justify-between">
                      <span className="text-muted-foreground">
                        Response Time
                      </span>
                      <span className="font-bold">
                        {property.landlord.responseTime}
                      </span>
                    </p>
                  </div>
                  <Link
                    href={`/messages?contact=landlord&propertyId=${property.id}`}
                  >
                    <Button
                      variant="outline"
                      className="w-full mt-4 border-3 border-foreground bg-transparent py-5 font-bold shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                    >
                      <MessageSquare className="mr-2 h-5 w-5" /> Contact
                      Landlord
                    </Button>
                  </Link>
                </div>

                {/* Report Listing Card */}
                <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <div className="flex items-center gap-2 mb-3">
                    <Flag className="h-5 w-5 text-muted-foreground" />
                    <h3 className="font-mono font-bold">Report an Issue</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    See something suspicious or incorrect about this listing?
                    Let us know.
                  </p>
                  <Button
                    onClick={() => setShowReportDialog(true)}
                    variant="outline"
                    className="w-full border-3 border-foreground bg-transparent py-5 font-bold shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  >
                    <Flag className="mr-2 h-4 w-4" />
                    Report Listing
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Lightbox Modal */}
      {showLightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/90 p-4">
          <button
            onClick={() => setShowLightbox(false)}
            className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center border-3 border-background bg-background text-foreground"
          >
            <X className="h-6 w-6" />
          </button>

          <button
            onClick={prevImage}
            className="absolute left-4 flex h-14 w-14 items-center justify-center border-3 border-background bg-background text-foreground"
          >
            <ChevronLeft className="h-8 w-8" />
          </button>

          <div className="max-w-4xl w-full">
            <div className="relative aspect-16/10 border-3 border-background bg-muted overflow-hidden">
              {(() => {
                const image = property.images[activeImageIndex];
                return (
                  <div className="w-full h-full flex items-center justify-center">
                    {image.url ? (
                      <Image
                        src={image.url}
                        alt={image.label}
                        fill
                        className="object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-muted/50">
                      <span className="font-mono text-2xl font-bold">
                        {image.label}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="mt-4 flex justify-center gap-2">
              {property.images.map((image, index) => {
                return (
                  <button
                    key={image.id}
                    onClick={() => setActiveImageIndex(index)}
                    className={`h-16 w-16 border-2 flex items-center justify-center overflow-hidden relative ${
                      activeImageIndex === index
                        ? "border-primary bg-primary/20"
                        : "border-background/50 bg-background/10"
                    }`}
                  >
                    {image.url ? (
                      <Image
                        src={image.url}
                        alt={image.label}
                        fill
                        className="object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}
                    <span className="text-xs font-bold text-background">
                      {image.label.charAt(0)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={nextImage}
            className="absolute right-4 flex h-14 w-14 items-center justify-center border-3 border-background bg-background text-foreground"
          >
            <ChevronRight className="h-8 w-8" />
          </button>
        </div>
      )}

      {/* Report Listing Dialog */}
      <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
        <DialogContent className="border-3 border-foreground shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] sm:max-w-md">
          {reportSubmitted ? (
            <div className="py-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center border-3 border-foreground bg-secondary">
                <Check className="h-8 w-8 text-foreground" />
              </div>
              <h3 className="font-mono text-xl font-bold mb-2">
                Report Submitted
              </h3>
              <p className="text-sm text-muted-foreground">
                Thank you for helping keep our marketplace safe. We'll review
                this report shortly.
              </p>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono text-xl font-bold">
                  Report Listing
                </DialogTitle>
                <DialogDescription>
                  Help us maintain a trustworthy marketplace by reporting
                  suspicious or incorrect listings.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="category" className="font-bold">
                    Report Category
                  </Label>
                  <Select
                    value={reportCategory}
                    onValueChange={setReportCategory}
                  >
                    <SelectTrigger
                      id="category"
                      className="border-3 border-foreground shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                    >
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent className="border-3 border-foreground">
                      <SelectItem value="fraud">Fraudulent Listing</SelectItem>
                      <SelectItem value="incorrect">
                        Incorrect Information
                      </SelectItem>
                      <SelectItem value="unavailable">
                        Property Not Available
                      </SelectItem>
                      <SelectItem value="duplicate">
                        Duplicate Listing
                      </SelectItem>
                      <SelectItem value="inappropriate">
                        Inappropriate Content
                      </SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="details" className="font-bold">
                    Additional Details
                  </Label>
                  <Textarea
                    id="details"
                    placeholder="Please provide more information about the issue..."
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    className="min-h-[120px] border-3 border-foreground shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                  />
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowReportDialog(false)}
                  className="border-3 border-foreground bg-transparent shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleReportSubmit}
                  disabled={!reportCategory || !reportDetails.trim()}
                  className="border-3 border-foreground bg-primary shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50"
                >
                  Submit Report
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
