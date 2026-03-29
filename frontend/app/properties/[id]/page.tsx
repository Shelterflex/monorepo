import type { Metadata } from "next";
import { allProperties } from "@/lib/mockData/properties";
import PropertyDetailClient from "./PropertyDetailClient";

type PropertyPageProps = {
  params: Promise<{
    id: string;
  }>;
};

const defaultTitle = "Property Details | ShelterFlex";
const defaultDescription =
  "Explore verified property details, amenities, and neighborhood context on ShelterFlex.";

export async function generateMetadata({ params }: PropertyPageProps): Promise<Metadata> {
  const { id } = await params;
  const property = allProperties.find((item) => item.id === Number.parseInt(id, 10));

  if (!property) {
    return {
      title: defaultTitle,
      description: defaultDescription,
    };
  }

  const title = `${property.title} - ${property.location} | ShelterFlex`;
  const description = `Discover ${property.title} in ${property.location}, including key details like bedrooms, bathrooms, and pricing.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function PropertyDetailPage({ params }: PropertyPageProps) {
  const { id } = await params;

  return <PropertyDetailClient propertyId={id} />;
}
