import type { Metadata } from "next"
import ContactClient from "./ContactClient"

export const metadata: Metadata = { title: "Contact Shelterflex", description: "Contact Shelterflex for help with rental financing, properties, and your account." }

export default function ContactPage() {
  return <ContactClient />
}
