import { Skeleton } from "@/components/ui/skeleton"

export default function PropertyDetailLoading() {
  const thumbnails = ["thumb-1", "thumb-2", "thumb-3", "thumb-4", "thumb-5", "thumb-6"]

  return (
    <main className="min-h-screen bg-background">
      {/* Breadcrumb */}
      <div className="border-b-3 border-foreground bg-muted">
        <div className="container mx-auto px-4 py-4">
          <Skeleton className="h-6 w-32" />
        </div>
      </div>

      {/* Image Gallery */}
      <section className="border-b-3 border-foreground">
        <div className="container mx-auto px-4 py-8">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Skeleton className="aspect-16/10 border-3 border-foreground shadow-[6px_6px_0px_0px_rgba(26,26,26,1)]" />
            </div>
            <div className="grid grid-cols-3 gap-3 lg:grid-cols-2">
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

      {/* Title + Location + Price */}
      <section className="border-b-3 border-foreground py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-3">
              <Skeleton className="h-10 w-72" />
              <Skeleton className="h-5 w-48" />
            </div>
            <Skeleton className="h-10 w-40 border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" />
          </div>
        </div>
      </section>

      {/* Property Specs Grid */}
      <section className="border-b-3 border-foreground py-8">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-3 gap-4">
            {["Bedrooms", "Bathrooms", "Area"].map((label) => (
              <div
                key={label}
                className="flex flex-col items-center gap-2 border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              >
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Description */}
      <section className="py-8">
        <div className="container mx-auto px-4">
          <Skeleton className="mb-4 h-8 w-40" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </section>
    </main>
  )
}
