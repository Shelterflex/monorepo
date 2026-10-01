import type { Metadata } from "next";
import { getProperty, type PropertyListing } from "@/lib/propertiesApi";
import { formatNgn } from "@/lib/currency";
import {
  DEFAULT_OG_IMAGE,
  SITE_NAME,
  absoluteUrl,
  buildPageMetadata,
} from "@/lib/seo";
import PropertyDetailClient from "./PropertyDetailClient";

type PropertyPageProps = {
  params: Promise<{
    id: string;
  }>;
};

const defaultTitle = "Property Details";
const defaultDescription =
  "Explore verified property details, amenities, and neighborhood context on ShelterFlex.";

function locationLabel(listing: PropertyListing): string {
  return [listing.area, listing.city].filter(Boolean).join(", ");
}

/**
 * The share preview is the whole point of this route's metadata: a listing sent
 * over WhatsApp should show the property photo, the rent, and the location, not
 * a bare URL under the site-wide title.
 */
function listingDescription(listing: PropertyListing): string {
  const location = locationLabel(listing);
  const facts = [
    `${listing.bedrooms} bed`,
    `${listing.bathrooms} bath`,
    Number.isFinite(listing.annualRentNgn)
      ? `${formatNgn(listing.annualRentNgn, undefined, { fractionDigits: 0 })}/year`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const summary = listing.description?.trim();
  if (summary) {
    // Keep descriptions inside the ~160 characters unfurlers and SERPs show.
    return summary.length > 160 ? `${summary.slice(0, 157).trimEnd()}…` : summary;
  }

  return `${facts}${location ? ` in ${location}` : ""}. Rent now, pay later with ${SITE_NAME}.`;
}

export async function generateMetadata({
  params,
}: PropertyPageProps): Promise<Metadata> {
  const { id } = await params;
  const path = `/properties/${id}`;

  try {
    const result = await getProperty(id);
    const listing = result.data;

    const location = locationLabel(listing);
    const title = location ? `${listing.address}, ${location}` : listing.address;
    const description = listingDescription(listing);

    // OpenGraph images must be absolute; the listing's own photo is what makes
    // a shared link convert, so fall back to the site icon only if there is none.
    const photo = listing.photos?.find((url) => Boolean(url?.trim()));

    return buildPageMetadata({
      title,
      description,
      path,
      images: [
        {
          url: photo ? absoluteUrl(photo) : DEFAULT_OG_IMAGE,
          ...(photo ? { width: 1200, height: 630 } : {}),
          alt: `${listing.address}${location ? ` in ${location}` : ""}`,
        },
      ],
    });
  } catch {
    // A listing that can't be fetched still gets a canonical URL, so a shared
    // link doesn't compete with the site-wide default for its own address.
    return buildPageMetadata({
      title: defaultTitle,
      description: defaultDescription,
      path,
    });
  }
}

/**
 * Schema.org markup for the listing.
 *
 * Judged worthwhile: rental listings are exactly the content type search
 * engines surface with rich results, the data is already fetched server-side
 * for the metadata above, and every field maps onto an existing property on the
 * listing record — no invented values. Emitted only when the fetch succeeds.
 */
function listingJsonLd(id: string, listing: PropertyListing) {
  const location = locationLabel(listing);

  return {
    "@context": "https://schema.org",
    "@type": "Residence",
    name: listing.address,
    description: listingDescription(listing),
    url: absoluteUrl(`/properties/${id}`),
    ...(listing.photos?.length
      ? { image: listing.photos.map((photo) => absoluteUrl(photo)) }
      : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: listing.address,
      ...(listing.area ? { addressLocality: listing.area } : {}),
      ...(listing.city ? { addressRegion: listing.city } : {}),
      addressCountry: "NG",
    },
    numberOfBedrooms: listing.bedrooms,
    numberOfBathroomsTotal: listing.bathrooms,
    ...(Number.isFinite(listing.annualRentNgn)
      ? {
          offers: {
            "@type": "Offer",
            price: listing.annualRentNgn,
            priceCurrency: "NGN",
            availability: "https://schema.org/InStock",
            url: absoluteUrl(`/properties/${id}`),
          },
        }
      : {}),
    ...(location ? { areaServed: location } : {}),
  };
}

export default async function PropertyDetailPage({ params }: PropertyPageProps) {
  const { id } = await params;

  let jsonLd: ReturnType<typeof listingJsonLd> | null = null;
  try {
    const result = await getProperty(id);
    jsonLd = listingJsonLd(id, result.data);
  } catch {
    // Structured data is additive — a failed fetch just omits it. The client
    // component below renders its own error state for the visible page.
    jsonLd = null;
  }

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          // Serialised server-side from our own API response, not user input.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <PropertyDetailClient propertyId={id} />
    </>
  );
}
