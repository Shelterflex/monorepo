import type { Metadata } from "next"
import { buildPageMetadata } from "@/lib/seo"
import PrivacyClient from "./PrivacyClient"

export const metadata: Metadata = buildPageMetadata({ title: "Privacy Policy", description: "Learn how Shelterflex collects, uses, and protects your personal information.", path: "/privacy-policy" })

export default function PrivacyPolicyPage() {
  return <PrivacyClient />
}
