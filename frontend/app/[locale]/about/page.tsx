import type { Metadata } from "next"
import AboutClient from "./AboutClient"

export const metadata: Metadata = { title: "About Shelterflex", description: "Learn how Shelterflex is making quality housing and flexible rent payments more accessible in Nigeria." }

export default function AboutPage() {
  return <AboutClient />
}
