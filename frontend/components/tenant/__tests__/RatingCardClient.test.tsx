import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RatingCardClient } from "../RatingCardClient";
import * as ratingApi from "@/lib/tenantRatingCardApi";

vi.mock("@/lib/tenantRatingCardApi", () => ({
  getTenantRatingCard: vi.fn(),
  createShareLink: vi.fn(),
  revokeShareLink: vi.fn(),
  getCreatedShares: vi.fn(),
  forgetCreatedShares: vi.fn(),
  SHARE_TTL_CHOICES: [1, 7, 14, 30],
}));

const aggregate = {
  count: 2,
  averages: {
    paymentTimeliness: 4.25,
    propertyCare: 4.0,
    communication: 5,
    overall: 4.5,
  },
  recentComments: ["Paid every month on time.", "Left the compound spotless."],
};

describe("RatingCardClient (#1923)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders per-dimension averages, count and recent comments", async () => {
    vi.mocked(ratingApi.getTenantRatingCard).mockResolvedValue(aggregate);
    vi.mocked(ratingApi.getCreatedShares).mockReturnValue([]);
    render(<RatingCardClient />);

    expect(await screen.findByText("Overall")).toBeInTheDocument();
    expect(screen.getByText("4.50")).toBeInTheDocument();
    expect(screen.getByText(/2 ratings/)).toBeInTheDocument();
    expect(screen.getByText(/Paid every month on time/)).toBeInTheDocument();
  });

  it("shows an empty state for tenants without ratings", async () => {
    vi.mocked(ratingApi.getTenantRatingCard).mockResolvedValue({
      count: 0,
      averages: {
        paymentTimeliness: null,
        propertyCare: null,
        communication: null,
        overall: null,
      },
      recentComments: [],
    });
    vi.mocked(ratingApi.getCreatedShares).mockReturnValue([]);
    render(<RatingCardClient />);
    expect(await screen.findByText("No ratings yet")).toBeInTheDocument();
  });

  it("creates a share link and shows the token once with a copy button", async () => {
    vi.mocked(ratingApi.getTenantRatingCard).mockResolvedValue(aggregate);
    vi.mocked(ratingApi.createShareLink).mockResolvedValue({
      id: "share-1",
      token: "a".repeat(32),
      url: "/api/v1/public/rating-card/" + "a".repeat(32),
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    vi.mocked(ratingApi.getCreatedShares).mockReturnValue([]);

    render(<RatingCardClient />);
    await screen.findByText("Share links");

    const ttl = screen.getByLabelText("Valid for") as HTMLSelectElement;
    fireEvent.change(ttl, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /create link/i }));

    // The token is visible exactly once, on creation.
    expect(await screen.findByText(new RegExp("a{32}"))).toBeInTheDocument();
    expect(ratingApi.createShareLink).toHaveBeenCalledWith(7);
    expect(ratingApi.getCreatedShares).toHaveBeenCalled();
  });

  it("revokes an active link", async () => {
    vi.mocked(ratingApi.getTenantRatingCard).mockResolvedValue(aggregate);
    const share = {
      id: "share-1",
      token: "b".repeat(32),
      url: "/rating-card/" + "b".repeat(32),
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
    vi.mocked(ratingApi.getCreatedShares).mockReturnValue([share]);
    vi.mocked(ratingApi.revokeShareLink).mockResolvedValue(undefined);

    render(<RatingCardClient />);
    fireEvent.click(await screen.findByRole("button", { name: /revoke/i }));

    await waitFor(() => expect(ratingApi.revokeShareLink).toHaveBeenCalledWith("share-1"));
    expect(screen.getByText(/Expires/)).toBeInTheDocument();
  });
});
