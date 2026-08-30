import type { Metadata } from "next"
import { privatePageMetadata } from "@/lib/seo"
import MapClient from "./MapClient"

export const metadata: Metadata = privatePageMetadata("Property Map", "Explore Shelterflex rental listings by location.")

export default function MapPage() {
  return <MapClient />
}
