import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import { RentToOwnClient } from "./RentToOwnClient";

export const metadata: Metadata = buildPageMetadata({
  title: "Rent-to-Own Calculator",
  description:
    "Estimate how rent-to-own payments build equity in your future home. Estimate only — final terms are set per deal.",
  path: "/calculator/rent-to-own",
});

export default function RentToOwnCalculatorPage() {
  return <RentToOwnClient />;
}
