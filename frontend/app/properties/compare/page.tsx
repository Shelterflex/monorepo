import type { Metadata } from "next"
import { privatePageMetadata } from "@/lib/seo"
import CompareClient from "./CompareClient"

export const metadata: Metadata = privatePageMetadata("Compare Properties", "Compare shortlisted Shelterflex properties side by side.")

export default function ComparePage() {
  return <CompareClient />
}
