import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicRatingCardView } from "../PublicRatingCardView";
import * as ratingApi from "@/lib/tenantRatingCardApi";

vi.mock("@/lib/tenantRatingCardApi", () => ({
  getPublicRatingCard: vi.fn(),
  RatingCardUnavailableError: class RatingCardUnavailableError extends Error {
    constructor() {
      super("This rating card link is no longer active.");
      this.name = "RatingCardUnavailableError";
    }
  },
}));

describe("PublicRatingCardView (#1923)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the masked display name and aggregate", async () => {
    vi.mocked(ratingApi.getPublicRatingCard).mockResolvedValue({
      displayName: "Ada O.",
      count: 3,
      averages: {
        paymentTimeliness: 4.67,
        propertyCare: 4.0,
        communication: 5,
        overall: 4.56,
      },
      recentComments: ["Great tenant."],
    });

    render(<PublicRatingCardView />);
    expect(await screen.findByText("Ada O.")).toBeInTheDocument();
    expect(screen.getByText(/3 landlord ratings/)).toBeInTheDocument();
    expect(screen.getByText("4.67")).toBeInTheDocument();
    expect(screen.getByText(/Great tenant/)).toBeInTheDocument();
  });

  it("shows the friendly expired/revoked state for an unavailable token", async () => {
    vi.mocked(ratingApi.getPublicRatingCard).mockRejectedValue(
      new ratingApi.RatingCardUnavailableError(),
    );

    render(<PublicRatingCardView />);
    expect(await screen.findByText("Link no longer active")).toBeInTheDocument();
  });
});
