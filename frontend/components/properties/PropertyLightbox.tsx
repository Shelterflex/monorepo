"use client"

import Image from "next/image"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { useFocusTrap } from "@/hooks/useFocusTrap"

export interface GalleryImage {
  id: number
  label: string
  url: string
}

interface PropertyLightboxProps {
  open: boolean
  images: GalleryImage[]
  activeImageIndex: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onThumbnailClick: (index: number) => void
}

export function PropertyLightbox({
  open,
  images,
  activeImageIndex,
  onClose,
  onPrev,
  onNext,
  onThumbnailClick,
}: PropertyLightboxProps) {
  const lightboxRef = useFocusTrap(open, onClose)

  if (!open) return null

  return (
    <div
      ref={lightboxRef}
      tabIndex={0}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/90 p-4 outline-none"
      role="dialog"
      aria-modal="true"
      aria-label="Image gallery"
    >
      <button
        onClick={onClose}
        aria-label="Close image gallery"
        className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center border-3 border-background bg-background text-foreground"
      >
        <X className="h-6 w-6" aria-hidden />
      </button>

      <button
        onClick={onPrev}
        aria-label="Previous image"
        className="absolute left-4 flex h-14 w-14 items-center justify-center border-3 border-background bg-background text-foreground"
      >
        <ChevronLeft className="h-8 w-8" aria-hidden />
      </button>

      <div className="max-w-4xl w-full">
        <div className="relative aspect-16/10 border-3 border-background bg-muted overflow-hidden">
          {(() => {
            const image = images[activeImageIndex]
            return (
              <div className="w-full h-full flex items-center justify-center">
                {image.url ? (
                  <Image
                    src={image.url}
                    alt={image.label}
                    fill
                    className="object-cover"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = "none"
                    }}
                  />
                ) : null}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-muted/50">
                  <span className="font-mono text-2xl font-bold">
                    {image.label}
                  </span>
                </div>
              </div>
            )
          })()}
        </div>
        <div className="mt-4 flex justify-center gap-2">
          {images.map((image, index) => (
            <button
              key={image.id}
              onClick={() => onThumbnailClick(index)}
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
                    ;(e.target as HTMLImageElement).style.display = "none"
                  }}
                />
              ) : null}
              <span className="text-xs font-bold text-background">
                {image.label.charAt(0)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onNext}
        aria-label="Next image"
        className="absolute right-4 flex h-14 w-14 items-center justify-center border-3 border-background bg-background text-foreground"
      >
        <ChevronRight className="h-8 w-8" aria-hidden />
      </button>
    </div>
  )
}
