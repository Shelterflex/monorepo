import { describe, it, expect, vi, beforeEach } from "vitest";
import { landlordApi } from "../landlordApi";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("../api", () => ({
  apiFetch: vi.fn(),
  apiPost: vi.fn(),
  apiGet: vi.fn(),
}));

import { apiFetch, apiPost } from "../api";

describe("landlordApi", () => {
  describe("getDashboardData", () => {
    it("fetches dashboard data from correct endpoint", async () => {
      vi.mocked(apiFetch).mockResolvedValue({
        stats: [],
        properties: [],
      });

      const result = await landlordApi.getDashboardData();

      expect(apiFetch).toHaveBeenCalledWith("/api/landlord/dashboard");
      expect(result.stats).toEqual([]);
      expect(result.properties).toEqual([]);
    });
  });

  describe("getProperties", () => {
    it("fetches all landlord properties", async () => {
      vi.mocked(apiFetch).mockResolvedValue([]);

      const result = await landlordApi.getProperties();

      expect(apiFetch).toHaveBeenCalledWith("/api/landlord/properties");
      expect(result).toEqual([]);
    });
  });

  describe("getProperty", () => {
    it("fetches a single property by string id", async () => {
      vi.mocked(apiFetch).mockResolvedValue({
        id: "P-001",
        title: "12 Marina",
        status: "active",
      });

      const result = await landlordApi.getProperty("P-001");

      expect(apiFetch).toHaveBeenCalledWith("/api/landlord/properties/P-001");
      expect(result.id).toBe("P-001");
    });

    it("fetches a single property by numeric id", async () => {
      vi.mocked(apiFetch).mockResolvedValue({
        id: 42,
        title: "14 Marina",
        status: "pending",
      });

      const result = await landlordApi.getProperty(42);

      expect(apiFetch).toHaveBeenCalledWith("/api/landlord/properties/42");
      expect(result.id).toBe(42);
    });
  });

  describe("getTenants", () => {
    it("fetches tenant list", async () => {
      vi.mocked(apiFetch).mockResolvedValue([]);

      const result = await landlordApi.getTenants();

      expect(apiFetch).toHaveBeenCalledWith("/api/landlord/tenants");
      expect(result).toEqual([]);
    });
  });

  describe("getApplications", () => {
    it("fetches application list", async () => {
      vi.mocked(apiFetch).mockResolvedValue([]);

      const result = await landlordApi.getApplications();

      expect(apiFetch).toHaveBeenCalledWith("/api/landlord/applications");
      expect(result).toEqual([]);
    });
  });

  describe("getAnalytics", () => {
    it("fetches analytics with no params", async () => {
      vi.mocked(apiFetch).mockResolvedValue({
        occupancyTrend: [],
        revenueBreakdown: [],
        paymentTrends: [],
        vacancyMetrics: { averageTimeToFill: 0, currentVacancyCount: 0 },
      });

      await landlordApi.getAnalytics();

      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("/api/landlord/analytics?"));
    });

    it("includes date range and propertyId in query", async () => {
      vi.mocked(apiFetch).mockResolvedValue({
        occupancyTrend: [],
        revenueBreakdown: [],
        paymentTrends: [],
        vacancyMetrics: { averageTimeToFill: 0, currentVacancyCount: 0 },
      });

      await landlordApi.getAnalytics({
        startDate: "2025-01-01",
        endDate: "2025-06-30",
        propertyId: "P-001",
      });

      const calledUrl = vi.mocked(apiFetch).mock.calls[0][0] as string;
      expect(calledUrl).toContain("startDate=2025-01-01");
      expect(calledUrl).toContain("endDate=2025-06-30");
      expect(calledUrl).toContain("propertyId=P-001");
    });
  });

  describe("createProperty", () => {
    it("POSTs property payload", async () => {
      vi.mocked(apiPost).mockResolvedValue({ id: "P-002" });

      const payload = { title: "New Property", location: "Lagos" };
      const result = await landlordApi.createProperty(payload);

      expect(apiPost).toHaveBeenCalledWith("/api/landlord/properties", payload);
      expect(result.id).toBe("P-002");
    });
  });
});

describe("error handling", () => {
  it("propagates errors from getDashboardData", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("Server Error"));
    await expect(landlordApi.getDashboardData()).rejects.toThrow("Server Error");
  });

  it("propagates errors from getProperty", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("Not Found"));
    await expect(landlordApi.getProperty("nonexistent")).rejects.toThrow("Not Found");
  });
});
