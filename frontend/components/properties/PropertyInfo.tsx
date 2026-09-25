"use client"

import { MapPin, Bed, Bath, Square, Heart, Share2 } from "lucide-react"
import { VerificationBadge } from "@/components/properties/verification-badge"
import { showSuccessToast, showErrorToast } from "@/lib/toast"

interface PropertyInfoProps {
  title: string
  address: string
  verificationStatus: string
  beds: number
  baths: number
  sqm: number
  isFavorite: boolean
  onFavoriteToggle: () => void
}

export function PropertyInfo({
  title,
  address,
  verificationStatus,
  beds,
  baths,
  sqm,
  isFavorite,
  onFavoriteToggle,
}: PropertyInfoProps) {
  const handleShare = async () => {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      showSuccessToast("Link copied to clipboard!")
    } catch (error) {
      showErrorToast(error, "Failed to copy link. Please try again.")
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-mono text-2xl font-black md:text-3xl lg:text-4xl">
            {title}
          </h1>
          <div className="flex items-center gap-3">
            <VerificationBadge status={verificationStatus as any} />
            {verificationStatus === "VERIFIED" && (
              <span className="text-xs text-muted-foreground font-mono">
                Verified by{" "}
                <span className="font-bold underline">
                  ShelterFlex Agent #104
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onFavoriteToggle}
            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={isFavorite}
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
            aria-label="Share property"
            className="flex h-10 w-10 items-center justify-center border-3 border-foreground bg-background shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] sm:h-12 sm:w-12"
          >
            <Share2 className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-muted-foreground mb-4">
        <MapPin className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
        <span className="text-sm sm:text-base lg:text-lg">{address}</span>
      </div>

      <div className="flex flex-wrap gap-2 sm:gap-4">
        <div className="flex items-center gap-1 border-2 border-foreground bg-muted px-2 py-1 sm:gap-2 sm:px-4 sm:py-2">
          <Bed className="h-4 w-4 sm:h-5 sm:w-5" />
          <span className="text-sm font-bold sm:text-base">{beds} Beds</span>
        </div>
        <div className="flex items-center gap-1 border-2 border-foreground bg-muted px-2 py-1 sm:gap-2 sm:px-4 sm:py-2">
          <Bath className="h-4 w-4 sm:h-5 sm:w-5" />
          <span className="text-sm font-bold sm:text-base">{baths} Baths</span>
        </div>
        <div className="flex items-center gap-1 border-2 border-foreground bg-muted px-2 py-1 sm:gap-2 sm:px-4 sm:py-2">
          <Square className="h-4 w-4 sm:h-5 sm:w-5" />
          <span className="text-sm font-bold sm:text-base">{sqm} m²</span>
        </div>
      </div>
    </div>
  )
}
