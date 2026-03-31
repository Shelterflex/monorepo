export const landlordBenefits = [
  {
    title: "Get Paid Upfront",
    description:
      "Receive full annual rent payment directly to your account within 48 hours of tenant move-in.",
  },
  {
    title: "Zero Default Risk",
    description:
      "We handle all payment collection. If a tenant defaults, it is on us, not you.",
  },
  {
    title: "Verified Tenants",
    description:
      "All tenants are thoroughly vetted with employment verification and credit checks.",
  },
  {
    title: "Fill Vacancies Faster",
    description:
      "Properties with flexible payment options get rented 3x faster on average.",
  },
  {
    title: "Quick Onboarding",
    description:
      "List your property in under 10 minutes. Our team handles all documentation.",
  },
  {
    title: "Property Management",
    description:
      "Optional property management services available for hands-off landlords.",
  },
];

export type LandlordStat = {
  value: string;
  label: string;
};

export const landlordStats: LandlordStat[] = [
  { value: "₦5B+", label: "Paid to Landlords" },
  { value: "500+", label: "Partner Landlords" },
  { value: "48hrs", label: "Avg. Payment Time" },
  { value: "0%", label: "Landlord Default Rate" },
];

export const landlordTestimonials = [
  {
    name: "Chief Adebayo",
    role: "Property Owner, Lagos",
    quote:
      "Shelterflex has transformed how I manage my rental properties. I get my money upfront and never have to chase tenants for rent again.",
  },
  {
    name: "Mrs. Okonkwo",
    role: "Estate Manager, Abuja",
    quote:
      "We have partnered with Shelterflex for our 50-unit estate and have seen occupancy rates increase significantly.",
  },
];
