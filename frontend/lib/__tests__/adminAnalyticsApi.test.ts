import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAnalyticsOverview,
  getDealFunnel,
  getRevenueTimeline,
  getListingQuality,
} from "../adminAnalyticsApi";
import { ApiError } from "../api";

vi.mock("../apiClient", () => ({
  apiGet: vi.fn(),
}));

import { apiGet } from "../apiClient";

const apiError = (status: number) => new ApiError({ message: `HTTP ${status}`, status });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAnalyticsOverview", () => {
  it("GETs the overview route and returns the response", async () => {
    const response = { success: true, data: { activeDeals: 3 } };
    vi.mocked(apiGet).mockResolvedValue(response);

    await expect(getAnalyticsOverview()).resolves.toEqual(response);
    expect(apiGet).toHaveBeenCalledWith("/api/admin/analytics/overview");
  });

  it("rejects with the ApiError on 401", async () => {
    vi.mocked(apiGet).mockRejectedValue(apiError(401));

    await expect(getAnalyticsOverview()).rejects.toMatchObject({ status: 401 });
  });
});

describe("getDealFunnel", () => {
  it("GETs the deal-funnel route", async () => {
    vi.mocked(apiGet).mockResolvedValue({ success: true, data: {} });

    await getDealFunnel();

    expect(apiGet).toHaveBeenCalledWith("/api/admin/analytics/deal-funnel");
  });

  it("rejects with the ApiError on 403", async () => {
    vi.mocked(apiGet).mockRejectedValue(apiError(403));

    await expect(getDealFunnel()).rejects.toMatchObject({ status: 403 });
  });
});

describe("getRevenueTimeline", () => {
  it("defaults the range to 30d", async () => {
    vi.mocked(apiGet).mockResolvedValue({ success: true, data: { series: [] } });

    await getRevenueTimeline();

    expect(apiGet).toHaveBeenCalledWith("/api/admin/analytics/revenue?range=30d");
  });

  it.each(["7d", "90d"] as const)("passes the %s range through", async (range) => {
    vi.mocked(apiGet).mockResolvedValue({ success: true, data: { series: [] } });

    await getRevenueTimeline(range);

    expect(apiGet).toHaveBeenCalledWith(`/api/admin/analytics/revenue?range=${range}`);
  });

  it("rejects with the ApiError on 500", async () => {
    vi.mocked(apiGet).mockRejectedValue(apiError(500));

    await expect(getRevenueTimeline("7d")).rejects.toMatchObject({ status: 500 });
  });
});

describe("getListingQuality", () => {
  it("GETs the listing-quality route", async () => {
    vi.mocked(apiGet).mockResolvedValue({ success: true, data: {} });

    await getListingQuality();

    expect(apiGet).toHaveBeenCalledWith("/api/admin/analytics/listing-quality");
  });

  it("rejects with the ApiError on 500", async () => {
    vi.mocked(apiGet).mockRejectedValue(apiError(500));

    await expect(getListingQuality()).rejects.toMatchObject({ status: 500 });
  });
});
