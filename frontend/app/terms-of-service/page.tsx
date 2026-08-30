import type { Metadata } from "next"
import { buildPageMetadata } from "@/lib/seo"
import TermsClient from "./TermsClient"

export const metadata: Metadata = buildPageMetadata({ title: "Terms of Service", description: "Read the terms that govern Shelterflex rental financing and property services.", path: "/terms-of-service" })

export default function TermsOfServicePage() {
  return <TermsClient />
}
