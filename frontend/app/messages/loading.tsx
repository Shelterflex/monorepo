import { Skeleton } from "@/components/ui/skeleton"

export default function MessagesLoading() {
  return (
    <div className="flex h-screen bg-background pt-20">
      {/* Conversations Sidebar */}
      <aside className="w-full border-r-3 border-foreground bg-card md:w-80 lg:w-96">
        <div className="border-b-3 border-foreground p-4">
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-10 w-10" />
          </div>
          <Skeleton className="h-10 w-full border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" />
        </div>

        <div className="space-y-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex gap-3 border-b-3 border-foreground p-4"
            >
              <Skeleton className="h-12 w-12 shrink-0 rounded-none border-3 border-foreground" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Chat Area */}
      <main className="hidden flex-1 flex-col md:flex">
        {/* Chat Header */}
        <div className="flex items-center justify-between border-b-3 border-foreground bg-card p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-none border-3 border-foreground" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-10" />
            <Skeleton className="h-10 w-10" />
            <Skeleton className="h-10 w-10" />
          </div>
        </div>

        {/* Message Bubbles */}
        <div className="flex-1 overflow-hidden bg-muted/30 p-6">
          <div className="mx-auto max-w-3xl space-y-4">
            {/* Incoming message */}
            <div className="flex justify-start">
              <Skeleton className="h-16 w-64 rounded-none border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" />
            </div>
            {/* Outgoing message */}
            <div className="flex justify-end">
              <Skeleton className="h-12 w-48 rounded-none border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" />
            </div>
            {/* Incoming message */}
            <div className="flex justify-start">
              <Skeleton className="h-20 w-72 rounded-none border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" />
            </div>
            {/* Outgoing message */}
            <div className="flex justify-end">
              <Skeleton className="h-14 w-56 rounded-none border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" />
            </div>
            {/* Incoming message */}
            <div className="flex justify-start">
              <Skeleton className="h-12 w-40 rounded-none border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" />
            </div>
          </div>
        </div>

        {/* Message Input */}
        <div className="border-t-3 border-foreground bg-card p-4">
          <div className="mx-auto flex max-w-3xl gap-4">
            <Skeleton className="h-10 w-10 shrink-0" />
            <Skeleton className="h-12 flex-1 border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" />
            <Skeleton className="h-12 w-14 border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]" />
          </div>
        </div>
      </main>
    </div>
  )
}
