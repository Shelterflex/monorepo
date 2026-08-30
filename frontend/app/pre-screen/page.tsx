import type { Metadata } from "next"
import { Suspense } from "react"
import { buildPageMetadata } from "@/lib/seo"
import { PreScreenClient } from "./PreScreenClient"

export const metadata: Metadata = buildPageMetadata({ title: "Rental Eligibility Pre-Screener", description: "Check your readiness for Shelterflex rent financing in a few simple steps.", path: "/pre-screen", noIndex: false })

export default function PreScreenPage() {
  return <Suspense fallback={<main className="min-h-screen bg-background"><div className="container mx-auto max-w-lg px-4 py-12"><p className="text-sm text-muted-foreground">Loading pre-screener...</p></div></main>}><PreScreenClient /></Suspense>
}
