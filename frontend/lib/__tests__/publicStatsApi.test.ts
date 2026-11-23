import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "../api";
import { getHomePageStats, getPublicLandlordStats } from "../publicStatsApi";

const fetchMock = vi.mocked(apiFetch);

const payload = {
  happyTenants: "1,200+",
  rentFinanced: "₦2.5B",
  partnerLandlords: "300+",
  citiesCovered: "5",
  totalPaidToLandlords: "₦900M",
  avgPaymentTime: "48h",
  landlordDefaultRate: "0.4%",
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("getHomePageStats", () => {
  it("GETs /public/stats and returns the payload", async () => {
    fetchMock.mockResolvedValueOnce({ success: true, data: payload });

    const stats = await getHomePageStats();

    expect(fetchMock).toHaveBeenCalledWith("/public/stats");
    expect(stats).toEqual(payload);
  });

  it("propagates request failures", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Service unavailable"));
    await expect(getHomePageStats()).rejects.toThrow("Service unavailable");
  });
});

describe("getPublicLandlordStats", () => {
  it("GETs /public/stats and returns the payload", async () => {
    fetchMock.mockResolvedValueOnce({ success: true, data: payload });

    const stats = await getPublicLandlordStats();

    expect(fetchMock).toHaveBeenCalledWith("/public/stats");
    expect(stats).toEqual(payload);
  });

  it("propagates request failures", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(getPublicLandlordStats()).rejects.toThrow("timeout");
  });
});
