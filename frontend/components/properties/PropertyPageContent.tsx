"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import dynamic from "next/dynamic"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionBoundary } from "@/components/section-boundary"
import useAuthStore from "@/store/useAuthStore"
import { getProperty, type PropertyListing } from "@/lib/propertiesApi"
import { propertyInspectionApi, type InspectionSummary } from "@/lib/propertyInspectionApi"
import { PropertyGallery } from "@/components/properties/PropertyGallery"
import { PropertyInfo } from "@/components/properties/PropertyInfo"
import { PropertyDescription } from "@/components/properties/PropertyDescription"
import { PropertyAmenities } from "@/components/properties/PropertyAmenities"
import { PropertyLightbox } from "@/components/properties/PropertyLightbox"
import { PropertyReportDialog } from "@/components/properties/PropertyReportDialog"
import { TrustIndicatorBar } from "@/components/properties/TrustIndicatorBar"
import type { GalleryImage } from "@/components/properties/PropertyLightbox"

const PropertySidebar = dynamic(() =>
  import("@/components/properties/PropertySidebar").then((mod) => mod.PropertySidebar)
)

const InspectionReportAccordion = dynamic(() =>
  import("@/components/properties/InspectionReportAccordion").then(
    (mod) => mod.InspectionReportAccordion
  )
)

const ApartmentReviews = dynamic(() =>
  import("@/components/properties/ApartmentReviews").then(
    (mod) => mod.ApartmentReviews
  )
)

interface PropertyPageContentProps {
  propertyId: string
}

export default function PropertyPageContent({
  propertyId,
}: PropertyPageContentProps) {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const [isFavorite, setIsFavorite] = useState(false)
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [showLightbox, setShowLightbox] = useState(false)
  const [paymentMonths, setPaymentMonths] = useState(12)
  const [showReportDialog, setShowReportDialog] = useState(false)
  const [inspectionSummary, setInspectionSummary] =
    useState<InspectionSummary | null>(null)
  const [isLoadingInspection, setIsLoadingInspection] = useState(false)
  const [listing, setListing] = useState<PropertyListing | null>(null)
  const [isLoadingProperty, setIsLoadingProperty] = useState(true)
  const [propertyError, setPropertyError] = useState<string | null>(null)

  const imagesLengthRef = useRef(0)
  const showLightboxRef = useRef(false)

  useEffect(() => {
    const fetchProperty = async () => {
      setIsLoadingProperty(true)
      setPropertyError(null)
      try {
        const result = await getProperty(propertyId)
        setListing(result.data)
      } catch (err: any) {
        setPropertyError(err?.message || "Failed to load property")
      } finally {
        setIsLoadingProperty(false)
      }
    }
    fetchProperty()
  }, [propertyId])

  useEffect(() => {
    const fetchInspectionSummary = async () => {
      setIsLoadingInspection(true)
      try {
        const summary =
          await propertyInspectionApi.getInspectionSummary(propertyId)
        setInspectionSummary(summary)
      } catch (error) {
        setInspectionSummary(null)
      } finally {
        setIsLoadingInspection(false)
      }
    }
    fetchInspectionSummary()
  }, [propertyId])

  const property = listing
    ? {
        id: Number.parseInt(listing.listingId) || 0,
        title: listing.address,
        location: [listing.city, listing.area].filter(Boolean).join(", "),
        address: listing.address,
        price: listing.annualRentNgn,
        outrightPriceNgn: listing.outrightPriceNgn,
        installmentBasePriceNgn: listing.installmentBasePriceNgn,
        beds: listing.bedrooms,
        baths: listing.bathrooms,
        sqm: 0,
        image: listing.photos?.[0] || "/placeholder.svg",
        verificationStatus:
          listing.status === "approved"
            ? "VERIFIED"
            : listing.status.toUpperCase(),
        tag: null,
        tagColor: null,
        description: listing.description || "",
        features: [],
        images: (listing.photos || []).map(
          (url: string, idx: number) =>
            ({
              id: idx + 1,
              label: `Photo ${idx + 1}`,
              url,
            }) as GalleryImage
        ),
        landlord: {
          name: "Property Owner",
          verified: false,
          listings: 1,
          responseTime: "Within 24 hours",
        },
        whistleblower: null,
      }
      : null

  imagesLengthRef.current = property?.images.length ?? 0
  showLightboxRef.current = showLightbox

  const nextImage = useCallback(() => {
    setActiveImageIndex(
      (prev) => (prev + 1) % (imagesLengthRef.current || 1)
    )
  }, [])

  const prevImage = useCallback(() => {
    setActiveImageIndex(
      (prev) =>
        (prev - 1 + (imagesLengthRef.current || 1)) %
        (imagesLengthRef.current || 1)
    )
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showLightboxRef.current) {
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault()
            prevImage()
            break
          case "ArrowRight":
            e.preventDefault()
            nextImage()
            break
          case "Escape":
            e.preventDefault()
            setShowLightbox(false)
            break
        }
        return
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault()
          prevImage()
          break
        case "ArrowRight":
          e.preventDefault()
          nextImage()
          break
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [prevImage, nextImage])

  if (isLoadingProperty) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground font-mono">Loading property...</p>
        </div>
      </main>
    )
  }

  if (propertyError || !property) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="border-3 border-foreground bg-card p-12 text-center shadow-[6px_6px_0px_0px_rgba(26,26,26,1)]">
          <Home className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
          <h1 className="font-mono text-2xl font-black mb-2">
            Property Not Found
          </h1>
          <p className="text-muted-foreground mb-6">
            The property you&apos;re looking for doesn&apos;t exist.
          </p>
          <Link href="/properties">
            <Button className="border-3 border-foreground bg-primary px-6 py-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              Browse Properties
            </Button>
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
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

      <PropertyGallery
        images={property.images}
        activeImageIndex={activeImageIndex}
        onImageChange={setActiveImageIndex}
        onPrev={prevImage}
        onNext={nextImage}
        onLightboxOpen={() => setShowLightbox(true)}
        tag={property.tag}
        tagColor={property.tagColor}
      />

      <section className="py-8">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-8">
              <PropertyInfo
                title={property.title}
                address={property.address}
                verificationStatus={property.verificationStatus}
                beds={property.beds}
                baths={property.baths}
                sqm={property.sqm}
                isFavorite={isFavorite}
                onFavoriteToggle={() => setIsFavorite(!isFavorite)}
              />

              <SectionBoundary section="property-trust-bar" userRole="guest">
                <TrustIndicatorBar
                  landlordKyc={property.landlord?.verified ?? false}
                  inspectionPass={
                    inspectionSummary
                      ? {
                          date: inspectionSummary.approvedAt,
                          inspectorName: `Inspector #${inspectionSummary.inspectionId.slice(0, 8)}`,
                        }
                      : null
                  }
                  whistleblowerCleared={!!property.whistleblower}
                  verificationStatus={property.verificationStatus as any}
                />
              </SectionBoundary>

              <PropertyDescription description={property.description} />

              <PropertyAmenities features={property.features} />

              <SectionBoundary
                section="property-inspection-report"
                userRole="guest"
              >
                <InspectionReportAccordion
                  report={
                    (inspectionSummary
                      ? {
                          overallGrade:
                            inspectionSummary.passCount >
                            inspectionSummary.failCount
                              ? "A"
                              : inspectionSummary.passCount ===
                                  inspectionSummary.failCount
                                ? "B"
                                : "C",
                          roomConditions: inspectionSummary.categoryResults,
                          photos: property.images
                            .slice(0, 3)
                            .map((img) => img.url)
                            .filter(Boolean) as string[],
                        }
                      : null) as any
                  }
                />
              </SectionBoundary>

              <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h2 className="font-mono text-xl font-bold mb-4">
                  Property Gallery
                </h2>
                <p className="text-muted-foreground mb-4">
                  Click on any room to view full size
                </p>
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                  {property.images.map(
                    (image: GalleryImage, index: number) => (
                      <button
                        key={image.id}
                        onClick={() => {
                          setActiveImageIndex(index)
                          setShowLightbox(true)
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
                              ;(
                                e.target as HTMLImageElement
                              ).style.display = "none"
                            }}
                          />
                        ) : null}
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors bg-muted/50">
                          <span className="font-mono font-bold">
                            {image.label}
                          </span>
                        </div>
                      </button>
                    )
                  )}
                </div>
              </div>

              <SectionBoundary section="property-reviews" userRole="guest">
                <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <h2 className="font-mono text-xl font-bold mb-6">
                    User Feedback & Reviews
                  </h2>
                  <Suspense
                    fallback={
                      <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                        <p className="text-muted-foreground font-mono">
                          Loading reviews...
                        </p>
                      </div>
                    }
                  >
                    <ApartmentReviews
                      key={propertyId}
                      propertyId={propertyId}
                    />
                  </Suspense>
                </div>
              </SectionBoundary>
            </div>

            <div className="lg:col-span-1">
              <SectionBoundary
                section="property-sidebar"
                userRole={isAuthenticated ? "tenant" : "guest"}
              >
                <PropertySidebar
                  price={property.price}
                  outrightPriceNgn={property.outrightPriceNgn}
                  installmentBasePriceNgn={property.installmentBasePriceNgn}
                  paymentMonths={paymentMonths}
                  onPaymentMonthsChange={setPaymentMonths}
                  isAuthenticated={isAuthenticated}
                  verificationStatus={property.verificationStatus}
                  landlord={{
                    name: property.landlord.name,
                    verified: property.landlord.verified,
                    listings: property.landlord.listings,
                    responseTime: property.landlord.responseTime,
                    listedSince: (property.landlord as any).listedSince,
                  }}
                  whistleblower={property.whistleblower}
                  onReportOpen={() => setShowReportDialog(true)}
                />
              </SectionBoundary>
            </div>
          </div>
        </div>
      </section>

      <PropertyLightbox
        open={showLightbox}
        images={property.images}
        activeImageIndex={activeImageIndex}
        onClose={() => setShowLightbox(false)}
        onPrev={prevImage}
        onNext={nextImage}
        onThumbnailClick={setActiveImageIndex}
      />

      <PropertyReportDialog
        open={showReportDialog}
        onOpenChange={setShowReportDialog}
        propertyId={propertyId}
      />
    </main>
  )
}
