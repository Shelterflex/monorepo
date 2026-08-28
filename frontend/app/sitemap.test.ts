import { describe, it, expect, vi, beforeEach } from "vitest";
import sitemap from "./sitemap";
import robots from "./robots";
import * as propertiesApi from "@/lib/propertiesApi";
import { SITE_URL } from "@/lib/seo";

describe("sitemap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("generates a valid sitemap with all public static routes", async () => {
    vi.spyOn(propertiesApi, "listPublicListings").mockResolvedValue({
      success: true,
      data: [],
      total: 0,
      page: 1,
      pageSize: 100,
      totalPages: 0,
    });

    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain(`${SITE_URL}/`);
    expect(urls).toContain(`${SITE_URL}/properties`);
    expect(urls).toContain(`${SITE_URL}/landlords`);
    expect(urls).toContain(`${SITE_URL}/calculator`);
    expect(urls).toContain(`${SITE_URL}/calculator/rent-to-own`);
    expect(urls).toContain(`${SITE_URL}/about`);
    expect(urls).toContain(`${SITE_URL}/contact`);
    expect(urls).toContain(`${SITE_URL}/terms-of-service`);
    expect(urls).toContain(`${SITE_URL}/privacy-policy`);
    expect(urls).toContain(`${SITE_URL}/cookies`);

    // Verify properties
    entries.forEach((entry) => {
      expect(entry.url).toMatch(/^https?:\/\//);
      expect(entry.lastModified).toBeInstanceOf(Date);
      expect(typeof entry.changeFrequency).toBe("string");
      expect(typeof entry.priority).toBe("number");
      expect(entry.priority).toBeGreaterThanOrEqual(0);
      expect(entry.priority).toBeLessThanOrEqual(1);
    });
  });

  it("includes dynamic property listing routes when API returns listings", async () => {
    vi.spyOn(propertiesApi, "listPublicListings").mockResolvedValue({
      success: true,
      data: [
        {
          listingId: "prop-123",
          whistleblowerId: "wb-1",
          address: "123 Main St",
          bedrooms: 2,
          bathrooms: 2,
          annualRentNgn: 2000000,
          photos: [],
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-02-01T12:00:00.000Z",
        },
        {
          listingId: "prop-456",
          whistleblowerId: "wb-2",
          address: "456 Side Ave",
          bedrooms: 3,
          bathrooms: 3,
          annualRentNgn: 3500000,
          photos: [],
          status: "active",
          createdAt: "2026-01-15T00:00:00.000Z",
          updatedAt: "2026-02-10T08:30:00.000Z",
        },
      ],
      total: 2,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain(`${SITE_URL}/properties/prop-123`);
    expect(urls).toContain(`${SITE_URL}/properties/prop-456`);

    const propEntry = entries.find((e) => e.url === `${SITE_URL}/properties/prop-123`);
    expect(propEntry?.changeFrequency).toBe("daily");
    expect(propEntry?.priority).toBe(0.7);
    expect(propEntry?.lastModified).toEqual(new Date("2026-02-01T12:00:00.000Z"));
  });

  it("handles property API failure gracefully without breaking sitemap generation", async () => {
    vi.spyOn(propertiesApi, "listPublicListings").mockRejectedValue(new Error("Network error"));

    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.url === `${SITE_URL}/`)).toBe(true);
  });

  it("never includes any URL overlapping with robots.ts disallow list", async () => {
    vi.spyOn(propertiesApi, "listPublicListings").mockResolvedValue({
      success: true,
      data: [
        {
          listingId: "listing-abc",
          whistleblowerId: "wb-1",
          address: "Test Address",
          bedrooms: 1,
          bathrooms: 1,
          annualRentNgn: 1000000,
          photos: [],
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    const sitemapEntries = await sitemap();
    const robotsRules = robots();
    const disallowRules = (
      Array.isArray(robotsRules.rules) ? robotsRules.rules : [robotsRules.rules]
    ).flatMap((rule) => (Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow || ""]));

    for (const entry of sitemapEntries) {
      const url = new URL(entry.url);
      const path = url.pathname;

      for (const rule of disallowRules) {
        if (!rule) continue;
        if (rule.endsWith("/")) {
          expect(path.startsWith(rule)).toBe(false);
        } else {
          expect(path === rule || path.startsWith(`${rule}/`)).toBe(false);
        }
      }
    }
  });

  it("does not include excluded or noindex pages (such as non-canonical duplicates or private utilities)", async () => {
    vi.spyOn(propertiesApi, "listPublicListings").mockResolvedValue({
      success: true,
      data: [],
      total: 0,
      page: 1,
      pageSize: 100,
      totalPages: 0,
    });

    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    // Non-canonical duplicates
    expect(urls).not.toContain(`${SITE_URL}/privacy`);
    expect(urls).not.toContain(`${SITE_URL}/terms`);

    // Noindex property sibling utilities
    expect(urls).not.toContain(`${SITE_URL}/properties/compare`);
    expect(urls).not.toContain(`${SITE_URL}/properties/saved`);
    expect(urls).not.toContain(`${SITE_URL}/properties/map`);

    // Obsolete or non-existent routes
    expect(urls).not.toContain(`${SITE_URL}/pricing`);
  });
});
