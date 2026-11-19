import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PropertyCard, PropertyImageCarousel } from "../property-card";

vi.mock("next/image", () => ({
  default: (props: { alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={props.alt} />
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/savedPropertiesApi", () => ({
  setListingSaved: vi.fn(),
}));

describe("PropertyImageCarousel", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  it("uses address-based alt text for images", () => {
    render(
      <PropertyImageCarousel
        property={{
          listingId: "1",
          address: "15 Admiralty Road",
          city: "Lagos",
          area: "Lekki",
          bedrooms: 3,
          bathrooms: 2,
          annualRentNgn: 2_400_000,
          photos: ["/a.jpg", "/b.jpg"],
        }}
      />,
    );

    expect(
      screen.getByAltText(
        "Photo 1 of 2 for 15 Admiralty Road, Lekki, Lagos",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByAltText(
        "Photo 2 of 2 for 15 Admiralty Road, Lekki, Lagos",
      ),
    ).toBeInTheDocument();
  });

  it("moves to the next slide on ArrowRight", () => {
    const { container } = render(
      <PropertyImageCarousel
        property={{
          listingId: "1",
          address: "15 Admiralty Road",
          bedrooms: 2,
          bathrooms: 1,
          annualRentNgn: 1_000_000,
          photos: ["/a.jpg", "/b.jpg"],
        }}
      />,
    );

    const carousel = container.querySelector('[role="region"]');
    expect(carousel).toBeTruthy();
    fireEvent.keyDown(carousel!, { key: "ArrowRight" });
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled();
  });
});

describe("PropertyCard", () => {
  it("shows payment type and verified inspection badges", () => {
    render(
      <PropertyCard
        property={{
          listingId: "listing-1",
          address: "Modern Flat",
          city: "Lagos",
          bedrooms: 2,
          bathrooms: 2,
          annualRentNgn: 2_000_000,
          hasApprovedInspection: true,
          paymentType: "installment",
        }}
        showFavorite={false}
      />,
    );

    expect(screen.getByText("Installment")).toBeInTheDocument();
    expect(screen.getByText("Verified inspection")).toBeInTheDocument();
  });

  it("gives icon-only favorite controls stateful accessible names", () => {
    const { rerender } = render(
      <PropertyCard
        property={{
          listingId: "listing-1",
          address: "Modern Flat",
          city: "Lagos",
          area: "Yaba",
          bedrooms: 2,
          bathrooms: 2,
          annualRentNgn: 2_000_000,
        }}
        showFavorite
        isFavorited={false}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Save property: Modern Flat, Yaba, Lagos",
      }),
    ).toHaveAttribute("aria-pressed", "false");

    rerender(
      <PropertyCard
        property={{
          listingId: "listing-1",
          address: "Modern Flat",
          city: "Lagos",
          area: "Yaba",
          bedrooms: 2,
          bathrooms: 2,
          annualRentNgn: 2_000_000,
        }}
        showFavorite
        isFavorited
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Saved: Modern Flat, Yaba, Lagos",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("uses a property-specific accessible name for the details link", () => {
    render(
      <PropertyCard
        property={{
          listingId: "listing-1",
          address: "Modern Flat",
          city: "Lagos",
          area: "Yaba",
          bedrooms: 2,
          bathrooms: 2,
          annualRentNgn: 2_000_000,
        }}
        showFavorite={false}
      />,
    );

    expect(
      screen.getByRole("link", {
        name: "View details for Modern Flat, Yaba, Lagos",
      }),
    ).toHaveAttribute("href", "/properties/listing-1");
  });

  it("renders the landlord verification badge when available", () => {
    render(
      <PropertyCard
        property={{
          listingId: "listing-2",
          address: "Verified Flat",
          city: "Lagos",
          bedrooms: 2,
          bathrooms: 1,
          annualRentNgn: 1_800_000,
          paymentType: "outright",
          landlordVerificationLevel: "id_verified",
        }}
        showFavorite={false}
      />,
    )

    expect(screen.getByText("ID Verified")).toBeInTheDocument();
  });
});
