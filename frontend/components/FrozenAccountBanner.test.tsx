import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FrozenAccountBanner from "./FrozenAccountBanner";

describe("FrozenAccountBanner", () => {
  it("renders with all props", () => {
    render(
      <FrozenAccountBanner
        freezeReason="Payment reversal detected"
        deficit={25000}
        ctaHref="/billing"
        ctaLabel="Resolve Now"
      />
    );

    expect(screen.getByText("Account frozen")).toBeInTheDocument();
    expect(screen.getByText(/Payment reversal detected/)).toBeInTheDocument();
    expect(screen.getByText("Resolve Now")).toBeInTheDocument();
  });

  it("renders deficit amount formatted as NGN", () => {
    render(<FrozenAccountBanner deficit={150000} />);

    // Intl.NumberFormat with NGN currency
    expect(screen.getByText(/150,000/)).toBeInTheDocument();
  });

  it("renders custom CTA label and href", () => {
    render(
      <FrozenAccountBanner
        deficit={5000}
        ctaHref="/payments"
        ctaLabel="Pay Now"
      />
    );

    const link = screen.getByText("Pay Now").closest("a");
    expect(link).toHaveAttribute("href", "/payments");
  });

  it("hides freeze reason when not provided", () => {
    render(<FrozenAccountBanner deficit={10000} />);

    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument();
  });

  it("clicking CTA link points to correct href", () => {
    render(
      <FrozenAccountBanner
        deficit={0}
        ctaHref="/wallet/topup"
        ctaLabel="Top up"
      />
    );

    const link = screen.getByText("Top up").closest("a");
    expect(link).toHaveAttribute("href", "/wallet/topup");
  });
});
