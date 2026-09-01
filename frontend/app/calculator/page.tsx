import type { Metadata } from "next"
import { buildPageMetadata } from "@/lib/seo"
import CalculatorClient from "./CalculatorClient"

export const metadata: Metadata = buildPageMetadata({
  title: "Rent Payment Calculator",
  description: "Estimate your deposit and monthly Shelterflex rent installments before you apply.",
  path: "/calculator",
})

export default function CalculatorPage() {
  return <CalculatorClient />
}
