import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { buildPageMetadata } from "@/lib/seo"

export const metadata: Metadata = buildPageMetadata({ title: "About Shelterflex", description: "Learn how Shelterflex is making quality housing and flexible rent payments more accessible in Nigeria.", path: "/about" })

export default function AboutRedirectPage() { redirect("/en/about") }
