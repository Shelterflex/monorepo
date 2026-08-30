import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { buildPageMetadata } from "@/lib/seo"

export const metadata: Metadata = buildPageMetadata({ title: "Contact Shelterflex", description: "Contact Shelterflex for help with rental financing, properties, and your account.", path: "/contact" })

export default function ContactRedirectPage() { redirect("/en/contact") }
