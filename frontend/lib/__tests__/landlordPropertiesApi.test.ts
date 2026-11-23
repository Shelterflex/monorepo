import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listLandlordProperties,
  getLandlordProperty,
  createLandlordProperty,
  updateLandlordProperty,
  deactivateLandlordProperty,
  relistLandlordProperty,
  getPhotoPresign,
  uploadPropertyPhotosBatch,
  deleteLandlordProperty,
  listPropertyApplications,
  reviewPropertyApplication,
  getLandlordDashboardStats,
  computeMarginPreview,
  MIN_OUTRIGHT_MARGIN_PERCENT,
} from "../landlordPropertiesApi";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("../apiClient", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock("../api", () => ({
  apiFetch: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

import { apiGet, apiPost, apiPatch } from "../apiClient";
import { apiFetch } from "../api";

describe("listLandlordProperties", () => {
  it("fetches properties with no params", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      properties: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });

    const result = await listLandlordProperties();

    expect(apiGet).toHaveBeenCalledWith("/api/landlord/properties");
    expect(result.properties).toEqual([]);
  });

  it("includes status, query, and page params", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      properties: [],
      total: 0,
      page: 2,
      pageSize: 10,
      totalPages: 1,
    });

    await listLandlordProperties({ status: "active", query: "Lagos", page: 2 });

    const path = vi.mocked(apiGet).mock.calls[0][0] as string;
    expect(path).toContain("status=active");
    expect(path).toContain("query=Lagos");
    expect(path).toContain("page=2");
  });
});

describe("getLandlordProperty", () => {
  it("fetches property by id", async () => {
    vi.mocked(apiGet).mockResolvedValue({ id: "P-001", title: "Test" });

    const result = await getLandlordProperty("P-001");

    expect(apiGet).toHaveBeenCalledWith("/api/landlord/properties/P-001");
    expect(result.id).toBe("P-001");
  });
});

describe("createLandlordProperty", () => {
  it("POSTs property payload", async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: "P-002", title: "New" });

    const payload = { title: "New", address: "12 Marina", bedrooms: 2, bathrooms: 1, annualRentNgn: 1_000_000, negotiatedLandlordRateNgn: 900_000, outrightPriceNgn: 950_000, installmentBasePriceNgn: 1_100_000, amenities: [], photos: [] };
    const result = await createLandlordProperty(payload);

    expect(apiPost).toHaveBeenCalledWith("/api/landlord/properties", payload);
    expect(result.id).toBe("P-002");
  });
});

describe("updateLandlordProperty", () => {
  it("PATCHes property with partial payload", async () => {
    vi.mocked(apiPatch).mockResolvedValue({ id: "P-001", title: "Updated" });

    const result = await updateLandlordProperty("P-001", { title: "Updated" });

    expect(apiPatch).toHaveBeenCalledWith("/api/landlord/properties/P-001", { title: "Updated" });
    expect(result.title).toBe("Updated");
  });
});

describe("deactivateLandlordProperty", () => {
  it("PATCHes deactivate endpoint", async () => {
    vi.mocked(apiPatch).mockResolvedValue({ id: "P-001", status: "inactive" });

    const result = await deactivateLandlordProperty("P-001");

    expect(apiPatch).toHaveBeenCalledWith("/api/landlord/properties/P-001/deactivate", {});
    expect(result.status).toBe("inactive");
  });
});

describe("relistLandlordProperty", () => {
  it("PATCHes relist endpoint", async () => {
    vi.mocked(apiPatch).mockResolvedValue({ id: "P-001", status: "active" });

    const result = await relistLandlordProperty("P-001");

    expect(apiPatch).toHaveBeenCalledWith("/api/landlord/properties/P-001/relist", {});
    expect(result.status).toBe("active");
  });
});

describe("getPhotoPresign", () => {
  it("POSTs to presign endpoint", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      strategy: "s3",
      uploadUrl: "https://s3.example.com/upload",
      method: "PUT",
      fieldName: "file",
      maxFiles: 10,
      expiresAt: "2025-12-31",
    });

    const result = await getPhotoPresign("P-001");

    expect(apiPost).toHaveBeenCalledWith("/api/properties/P-001/photos/presign", {});
    expect(result.strategy).toBe("s3");
  });
});

describe("uploadPropertyPhotosBatch", () => {
  it("POSTs FormData to batch endpoint", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      results: [{ success: true, photo: { url: "https://example.com/photo.jpg", id: "PH-001" } }],
    });

    const file = new File(["test"], "photo.jpg", { type: "image/jpeg" });
    const result = await uploadPropertyPhotosBatch("P-001", [file]);

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/properties/P-001/photos/batch",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.results).toHaveLength(1);
  });
});

describe("deleteLandlordProperty", () => {
  it("DELETEs property by id", async () => {
    vi.mocked(apiFetch).mockResolvedValue(undefined);

    await deleteLandlordProperty("P-001");

    expect(apiFetch).toHaveBeenCalledWith("/api/landlord/properties/P-001", {
      method: "DELETE",
    });
  });
});

describe("listPropertyApplications", () => {
  it("fetches applications for a listing", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      applications: [],
      total: 0,
    });

    const result = await listPropertyApplications("L-001");

    expect(apiGet).toHaveBeenCalledWith("/api/v1/listings/L-001/applications");
    expect(result.applications).toEqual([]);
  });
});

describe("reviewPropertyApplication", () => {
  it("POSTs approve decision", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      id: "A-001",
      status: "approved",
    });

    const result = await reviewPropertyApplication("A-001", "approve", "Looks good");

    expect(apiPost).toHaveBeenCalledWith("/api/applications/A-001/review", {
      decision: "approve",
      notes: "Looks good",
    });
    expect(result.status).toBe("approved");
  });

  it("POSTs reject decision without notes", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      id: "A-002",
      status: "rejected",
    });

    const result = await reviewPropertyApplication("A-002", "reject");

    expect(apiPost).toHaveBeenCalledWith("/api/applications/A-002/review", {
      decision: "reject",
      notes: undefined,
    });
  });
});

describe("getLandlordDashboardStats", () => {
  it("fetches dashboard stats", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      totalProperties: 5,
      activeListings: 3,
      totalViews: 1200,
      monthlyRevenueNgn: 2_500_000,
    });

    const result = await getLandlordDashboardStats();

    expect(apiGet).toHaveBeenCalledWith("/api/landlord/dashboard/stats");
    expect(result.totalProperties).toBe(5);
  });
});

describe("computeMarginPreview", () => {
  it("computes outright and installment margins", () => {
    const result = computeMarginPreview(1_000_000, 1_100_000, 1_200_000);

    expect(result.outrightMarginPercent).toBeCloseTo(10);
    expect(result.installmentMarginPercent).toBeCloseTo(20);
    expect(result.belowRecommended).toBe(false);
    expect(result.orderInvalid).toBe(false);
  });

  it("marks belowRecommended when outright margin < 5%", () => {
    const result = computeMarginPreview(1_000_000, 1_040_000, 1_200_000);

    expect(result.outrightMarginPercent).toBeCloseTo(4);
    expect(result.belowRecommended).toBe(true);
  });

  it("marks orderInvalid when outright > installment", () => {
    const result = computeMarginPreview(1_000_000, 1_300_000, 1_200_000);

    expect(result.orderInvalid).toBe(true);
  });

  it("handles zero negotiated price", () => {
    const result = computeMarginPreview(0, 100, 200);

    expect(result.outrightMarginPercent).toBe(0);
    expect(result.installmentMarginPercent).toBe(0);
  });

  it("identical prices produce zero margins", () => {
    const result = computeMarginPreview(1_000_000, 1_000_000, 1_000_000);

    expect(result.outrightMarginPercent).toBe(0);
    expect(result.installmentMarginPercent).toBe(0);
    expect(result.belowRecommended).toBe(true);
    expect(result.orderInvalid).toBe(false);
  });
});

describe("MIN_OUTRIGHT_MARGIN_PERCENT", () => {
  it("is 0.05 (5%)", () => {
    expect(MIN_OUTRIGHT_MARGIN_PERCENT).toBe(0.05);
  });
});

describe("error handling", () => {
  it("propagates errors from listLandlordProperties", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("Unauthorized"));
    await expect(listLandlordProperties()).rejects.toThrow("Unauthorized");
  });
});
