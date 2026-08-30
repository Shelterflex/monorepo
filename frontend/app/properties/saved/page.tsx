import type { Metadata } from "next"
import { privatePageMetadata } from "@/lib/seo"
import SavedClient from "./SavedClient"

export const metadata: Metadata = privatePageMetadata("Saved Properties", "Your private Shelterflex property shortlist.")

export default function SavedPropertiesPage() {
  return <SavedClient />
}
