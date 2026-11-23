import { describe, it, expect } from "vitest";
import {
  DEFAULT_OG_IMAGE,
  NO_INDEX,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
  buildPageMetadata,
  privatePageMetadata,
  DEFAULT_DESCRIPTION,
} from "../seo";

describe("NO_INDEX robots directives", () => {
  it("blocks indexing, following, caching, archiving and snippets", () => {
    expect(NO_INDEX).toMatchObject({
      index: false,
      follow: false,
      nocache: true,
      noarchive: true,
      nosnippet: true,
    });
  });

  it("repeats the block for Google's crawler, including images", () => {
    expect((NO_INDEX as { googleBot?: unknown }).googleBot).toEqual({
      index: false,
      follow: false,
      noimageindex: true,
    });
  });
});

describe("absoluteUrl", () => {
  it("prefixes the site origin onto a route path", () => {
    expect(absoluteUrl("/properties")).toBe(`${SITE_URL}/properties`);
  });

  it("adds the missing leading slash", () => {
    expect(absoluteUrl("properties")).toBe(`${SITE_URL}/properties`);
  });

  it("defaults to the site root", () => {
    expect(absoluteUrl()).toBe(`${SITE_URL}/`);
  });

  it("returns absolute URLs unchanged", () => {
    expect(absoluteUrl("https://example.com/x")).toBe("https://example.com/x");
  });
});

describe("buildPageMetadata", () => {
  const base = { title: "Rent", description: "Pay rent later", path: "/rent" };

  it("sets a canonical URL and matching OpenGraph and Twitter tags", () => {
    const meta = buildPageMetadata(base);
    expect(meta.alternates).toEqual({ canonical: `${SITE_URL}/rent` });
    expect(meta.openGraph).toMatchObject({
      title: "Rent",
      description: "Pay rent later",
      url: `${SITE_URL}/rent`,
      siteName: SITE_NAME,
      type: "website",
    });
    expect(meta.twitter).toMatchObject({ title: "Rent", card: "summary" });
  });

  it("leaves robots unset for public pages", () => {
    expect(buildPageMetadata(base)).not.toHaveProperty("robots");
  });

  it("applies the NO_INDEX robots block when noIndex is set", () => {
    expect(buildPageMetadata({ ...base, noIndex: true }).robots).toBe(NO_INDEX);
  });

  it("falls back to the default share image and a summary card", () => {
    const meta = buildPageMetadata(base);
    expect(meta.openGraph?.images).toEqual([{ url: DEFAULT_OG_IMAGE, alt: SITE_NAME }]);
    expect(meta.twitter).toMatchObject({ card: "summary", images: [DEFAULT_OG_IMAGE] });
  });

  it("uses a large summary card when a custom image is supplied", () => {
    const meta = buildPageMetadata({
      ...base,
      type: "article",
      images: [{ url: "/hero.jpg", width: 1200, height: 630 }],
    });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: ["/hero.jpg"] });
    expect(meta.openGraph).toMatchObject({ type: "article" });
  });
});

describe("privatePageMetadata", () => {
  it("is always non-indexable and uses the default description when none is given", () => {
    expect(privatePageMetadata("Dashboard")).toEqual({
      title: "Dashboard",
      description: DEFAULT_DESCRIPTION,
      robots: NO_INDEX,
    });
  });

  it("keeps a custom description", () => {
    expect(privatePageMetadata("Dashboard", "Your deals").description).toBe("Your deals");
  });
});
