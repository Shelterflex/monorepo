import { Skeleton } from "@/components/ui/skeleton"

export default function PropertyDetailLoading() {
  const thumbnails = ["thumb-1", "thumb-2", "thumb-3", "thumb-4", "thumb-5", "thumb-6"]
  const featureRows = ["feature-1", "feature-2", "feature-3", "feature-4", "feature-5", "feature-6"]
  const galleryRows = ["gallery-1", "gallery-2", "gallery-3", "gallery-4", "gallery-5", "gallery-6"]

  return (
    <main id="main-content" className="min-h-screen bg-background">
      {/* Breadcrumb */}
      <div className="border-b-3 border-foreground bg-muted">
        <div className="container mx-auto px-4 py-4">
          <Skeleton className="h-6 w-44" />
        </div>
      </div>

      {/* Image Gallery */}
      <section className="border-b-3 border-foreground">
        <div className="container mx-auto px-4 py-8">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Skeleton className="aspect-16/10 border-3 border-foreground shadow-[6px_6px_0px_0px_rgba(26,26,26,1)]" />
            </div>
            <div className="grid grid-cols-3 gap-2 md:gap-3 lg:grid-cols-2">
              {thumbnails.map((id) => (
                <Skeleton
                  key={id}
                  className="aspect-square border-3 border-foreground shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Property Details */}
      <section className="py-8">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-8">
              <div>
                <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <Skeleton className="h-10 w-72 md:h-12 md:w-96" />
                  <div className="flex gap-2">
                    <Skeleton className="h-10 w-10 border-3 border-foreground shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] sm:h-12 sm:w-12" />
                    <Skeleton className="h-10 w-10 border-3 border-foreground shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] sm:h-12 sm:w-12" />
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <Skeleton className="h-5 w-5" />
                  <Skeleton className="h-6 w-80 max-w-full" />
                </div>

                <div className="flex flex-wrap gap-2 sm:gap-4">
                  {["Beds", "Baths", "Area"].map((label) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 border-2 border-foreground bg-muted px-2 py-1 sm:px-4 sm:py-2"
                    >
                      <Skeleton className="h-5 w-5" />
                      <Skeleton className="h-5 w-16" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] sm:p-6">
                <Skeleton className="mb-4 h-7 w-48" />
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>

              <div className="border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] sm:p-6">
                <Skeleton className="mb-4 h-7 w-56" />
                <div className="grid gap-3 sm:grid-cols-2">
                  {featureRows.map((id) => (
                    <div
                      key={id}
                      className="flex items-center gap-3 border-2 border-foreground bg-muted p-3"
                    >
                      <div className="flex h-8 w-8 items-center justify-center bg-secondary border-2 border-foreground">
                        <Skeleton className="h-4 w-4" />
                      </div>
                      <Skeleton className="h-5 w-40" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <Skeleton className="mb-4 h-7 w-48" />
                <Skeleton className="mb-4 h-5 w-64" />
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                  {galleryRows.map((id) => (
                    <Skeleton
                      key={id}
                      className="aspect-4/3 border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-1">
              <div className="sticky top-24 space-y-6">
                <div className="border-3 border-foreground bg-card p-4 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] sm:p-6">
                  <div className="mb-4">
                    <Skeleton className="h-4 w-24 mb-2" />
                    <Skeleton className="h-10 w-44 sm:h-12 sm:w-52" />
                  </div>

                  <div className="border-t-3 border-dashed border-foreground/30 pt-4 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Skeleton className="h-5 w-5" />
                      <Skeleton className="h-5 w-40" />
                    </div>

                    <Skeleton className="h-4 w-36 mb-3" />
                    <div className="flex gap-2 mb-4">
                      {["3mo", "6mo", "12mo"].map((label) => (
                        <Skeleton key={label} className="h-9 flex-1" />
                      ))}
                    </div>

                    <div className="border-3 border-primary bg-primary/10 p-4">
                      <Skeleton className="h-4 w-28 mb-2" />
                      <Skeleton className="h-9 w-40 mb-2" />
                      <Skeleton className="h-3 w-56 mb-1" />
                      <Skeleton className="h-3 w-44" />
                    </div>
                  </div>

                  <Skeleton className="h-14 w-full border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" />
                  <Skeleton className="h-3 w-48 mx-auto mt-3" />
                </div>

                <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <Skeleton className="h-6 w-24 mb-4" />
                  <div className="flex items-center gap-3 mb-4">
                    <Skeleton className="h-12 w-12 border-2 border-foreground" />
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-4 w-28" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                  <Skeleton className="h-12 w-full border-3 border-foreground shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] mt-4" />
                </div>

                <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <div className="flex items-center gap-2 mb-3">
                    <Skeleton className="h-5 w-5" />
                    <Skeleton className="h-6 w-32" />
                  </div>
                  <Skeleton className="h-4 w-full mb-4" />
                  <Skeleton className="h-12 w-full border-3 border-foreground shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
