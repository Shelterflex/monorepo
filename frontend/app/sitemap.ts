import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * Sitemap for public, indexable routes.
 *
 * This file generates a sitemap.xml for search engines, listing all genuinely
 * public pages that should be crawled and indexed. It deliberately excludes
 * any routes listed in robots.ts's disallow list to ensure consistency.
 *
 * Dynamic routes (e.g., /properties/[id]) are not included here; they would
 * require fetching real listing data from the API. This is tracked as a
 * follow-up improvement.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_URL;

  // Static public routes - these are the genuinely indexable pages
  // Cross-referenced with robots.ts disallow list to ensure no overlap
  const staticRoutes = [
    "",
    "/about",
    "/contact",
    "/calculator",
    "/calculator/rent-to-own",
    "/cookies",
    "/governance",
    "/landlords",
    "/privacy",
    "/privacy-policy",
    "/properties",
    "/properties/compare",
    "/properties/map",
    "/properties/saved",
    "/terms",
    "/terms-of-service",
  ];

  return staticRoutes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: route === "" ? 1 : 0.8,
  }));
}
