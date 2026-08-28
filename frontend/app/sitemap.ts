import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { listPublicListings } from "@/lib/propertiesApi";

interface StaticRouteConfig {
  path: string;
  changeFrequency:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority: number;
}

/**
 * Genuinely public, indexable static routes.
 *
 * Excludes all private/auth routes disallowed in robots.ts, as well as noindex utility and placeholder duplicates.
 */
const STATIC_ROUTES: StaticRouteConfig[] = [
  { path: "/", changeFrequency: "daily", priority: 1.0 },
  { path: "/properties", changeFrequency: "daily", priority: 0.9 },
  { path: "/landlords", changeFrequency: "weekly", priority: 0.8 },
  { path: "/calculator", changeFrequency: "monthly", priority: 0.8 },
  { path: "/calculator/rent-to-own", changeFrequency: "monthly", priority: 0.8 },
  { path: "/about", changeFrequency: "monthly", priority: 0.7 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.7 },
  { path: "/terms-of-service", changeFrequency: "monthly", priority: 0.5 },
  { path: "/privacy-policy", changeFrequency: "monthly", priority: 0.5 },
  { path: "/cookies", changeFrequency: "monthly", priority: 0.5 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: new Date(),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  let dynamicEntries: MetadataRoute.Sitemap = [];
  try {
    const response = await listPublicListings({ pageSize: 100 });
    if (response?.data && Array.isArray(response.data)) {
      dynamicEntries = response.data.map((listing) => ({
        url: absoluteUrl(`/properties/${listing.listingId}`),
        lastModified: listing.updatedAt ? new Date(listing.updatedAt) : new Date(),
        changeFrequency: "daily",
        priority: 0.7,
      }));
    }
  } catch {
    // Gracefully degrade if the API is unreachable during build or static generation
    dynamicEntries = [];
  }

  return [...staticEntries, ...dynamicEntries];
}