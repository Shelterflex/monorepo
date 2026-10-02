"use client"

import Image from "next/image"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { GalleryImage } from "./PropertyLightbox"

interface PropertyGalleryProps {
  images: GalleryImage[]
  activeImageIndex: number
  onImageChange: (index: number) => void
  onPrev: () => void
  onNext: () => void
  onLightboxOpen: () => void
  tag?: string | null
  tagColor?: string | null
}

export function PropertyGallery({
  images,
  activeImageIndex,
  onImageChange,
  onPrev,
  onNext,
  onLightboxOpen,
  tag,
  tagColor,
}: PropertyGalleryProps) {
  return (
    <section className="border-b-3 border-foreground">
      <div className="container mx-auto px-4 py-8">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="relative aspect-[16/10] w-full border-3 border-foreground bg-muted shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] overflow-hidden group">
              <button
                type="button"
                aria-label="Open image gallery"
                aria-haspopup="dialog"
                className="absolute inset-0 z-10"
                onClick={onLightboxOpen}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                {(() => {
                  const image = images[activeImageIndex]
                  return (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      {image.url ? (
                        <Image
                          src={image.url}
                          alt={image.label}
                          fill
                          className="object-cover"
                          onError={(e) => {
                            ;(e.target as HTMLImageElement).style.display =
                              "none"
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
                  )
                })()}
              </div>

              {tag && (
                <span
                  className={`absolute left-4 top-4 border-3 border-foreground ${tagColor} px-3 py-1 text-sm font-bold`}
                >
                  {tag}
                </span>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onPrev()
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex h-12 w-12 items-center justify-center border-3 border-foreground bg-background shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onNext()
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex h-12 w-12 items-center justify-center border-3 border-foreground bg-background shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              >
                <ChevronRight className="h-6 w-6" />
              </button>

              <div className="absolute bottom-4 right-4 z-20 border-2 border-foreground bg-background px-3 py-1 font-mono text-sm font-bold">
                {activeImageIndex + 1} / {images.length}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 md:gap-3 lg:grid-cols-2">
            {images.slice(0, 6).map((image, index) => (
              <button
                key={image.id}
                onClick={() => onImageChange(index)}
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
                      ;(e.target as HTMLImageElement).style.display = "none"
                    }}
                  />
                ) : null}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground p-2 bg-muted/50">
                  <span className="text-xs font-bold text-center leading-tight">
                    {image.label}
                  </span>
                </div>
              </button>
            ))}
            {images.length > 6 && (
              <button
                onClick={onLightboxOpen}
                className="relative aspect-square border-3 border-foreground bg-foreground text-background shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:translate-x-px hover:translate-y-px transition-all"
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-2xl font-black">
                    +{images.length - 6}
                  </span>
                  <span className="text-xs font-bold">More</span>
                </div>
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
