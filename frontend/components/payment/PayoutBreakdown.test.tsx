import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PayoutBreakdown } from "./PayoutBreakdown";
import type { PayoutBreakdown as PayoutBreakdownType } from "@/lib/paymentApi";

// Mock next-intl
vi.mock("next-intl", () => ({
  useLocale: () => "en-NG",
  useTranslations: (namespace: string) => {
    // Simple mock that returns the key or a mapped value
    const messages: Record<string, Record<string, string>> = {
      payment: {
        paymentConfirmed: "Payment confirmed",
        rewardDistribution: "Reward distribution",
        platformFee: "Platform fee",
        platformFeeSubLabel: "Covers platform operations",
        reporterReward: "Reporter reward",
        reporterRewardSubLabel: "Paid to the property reporter",
        noReporter: "No reporter on this listing",
        landlordPayout: "Landlord payout",
        totalCharged: "Total charged",
      },
    };
    return (key: string) => messages[namespace]?.[key] || key;
  },
}));

const baseBreakdown: PayoutBreakdownType = {
  totalAmount: 500_000,
  platformShare: 25_000,
  reporterShare: 10_000,
  landlordAmount: 465_000,
  currency: "NGN",
};

describe("PayoutBreakdown", () => {
  it("renders all line items with reporter present", () => {
    render(<PayoutBreakdown breakdown={baseBreakdown} />);

    expect(screen.getByText("Platform fee")).toBeInTheDocument();
    expect(screen.getByText("Reporter reward")).toBeInTheDocument();
    expect(screen.getByText("Landlord payout")).toBeInTheDocument();
    expect(screen.getByText("Total charged")).toBeInTheDocument();
  });

  it("shows dash when reporter is null", () => {
    render(<PayoutBreakdown breakdown={{ ...baseBreakdown, reporterShare: null }} />);

    expect(screen.getByText("No reporter on this listing")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows confirmed badge when confirmed=true", () => {
    render(<PayoutBreakdown breakdown={baseBreakdown} confirmed />);

    expect(screen.getByText("Payment confirmed")).toBeInTheDocument();
  });

  it("does not show confirmed badge by default", () => {
    render(<PayoutBreakdown breakdown={baseBreakdown} />);

    expect(screen.queryByText("Payment confirmed")).not.toBeInTheDocument();
  });

  it("formats amounts as NGN currency with decimals", () => {
    render(<PayoutBreakdown breakdown={baseBreakdown} />);

    // Total should be formatted — Intl formats 500000 as ₦500,000.00
    // We use a regex to match both the number and the decimals
    expect(screen.getByText(/500,000\.00/)).toBeInTheDocument();
  });
});

describe("PayoutBreakdown totals", () => {
  // Parse a formatted line amount ("₦25,000.00" / "25.00 USDC") back to a number.
  const parse = (text: string) => Number(text.replace(/[^\d.-]/g, ""));
  const amountFor = (label: string) =>
    parse(screen.getByText(label).parentElement!.nextElementSibling!.textContent!);

  it.each([
    ["with a reporter", baseBreakdown],
    ["without a reporter", { ...baseBreakdown, reporterShare: null, landlordAmount: 475_000 }],
    [
      "with large amounts",
      {
        totalAmount: 987_654_321.75,
        platformShare: 49_382_716.09,
        reporterShare: 9_876_543.22,
        landlordAmount: 928_395_062.44,
        currency: "NGN",
      },
    ],
  ])("line items sum to the total charged %s", (_label, breakdown) => {
    render(<PayoutBreakdown breakdown={breakdown} />);

    const reporter = breakdown.reporterShare === null ? 0 : amountFor("Reporter reward");
    const parts = amountFor("Platform fee") + reporter + amountFor("Landlord payout");
    expect(parts).toBeCloseTo(amountFor("Total charged"), 2);
    expect(amountFor("Total charged")).toBeCloseTo(breakdown.totalAmount, 2);
  });

  it("formats USDC breakdowns with the USDC suffix", () => {
    render(
      <PayoutBreakdown
        breakdown={{ totalAmount: 100, platformShare: 5, reporterShare: 1, landlordAmount: 94, currency: "USDC" }}
      />,
    );

    expect(screen.getByText("Total charged").parentElement!.nextElementSibling).toHaveTextContent(/100\.00 USDC/);
  });

  it("formats an all-zero breakdown", () => {
    render(
      <PayoutBreakdown
        breakdown={{ totalAmount: 0, platformShare: 0, reporterShare: 0, landlordAmount: 0, currency: "NGN" }}
      />,
    );

    expect(screen.getAllByText("₦0.00")).toHaveLength(4);
  });
});
