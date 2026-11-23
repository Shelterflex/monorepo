import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import { PublicRatingCardView } from "./PublicRatingCardView";

/**
 * Public, read-only tenant rating card addressed by an expiring share token
 * (#1923). never indexed: the URL itself is the secret.
 */
export const metadata: Metadata = {
  ...buildPageMetadata({
    title: "Tenant rating card",
    description: "A read-only tenant rating card shared with you.",
    path: "/rating-card",
    noIndex: true,
  }),
};

export default function PublicRatingCardPage() {
  return <PublicRatingCardView />;
}
