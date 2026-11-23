import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchQuotaUsage,
  fetchQuotaOverrides,
  createQuotaOverride,
  removeQuotaOverride,
  fetchQuotaStats,
  resetQuota,
} from "../quotaAdminApi";
import { ApiError } from "../api";

vi.mock("../apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apiClient")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  apiFetch: vi.fn(),
}));

import { apiGet, apiPost } from "../apiClient";
import { apiFetch } from "../api";

const apiError = (status: number) => new ApiError({ message: `HTTP ${status}`, status });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchQuotaUsage", () => {
  it("encodes userId and sends no query when endpoint is omitted", async () => {
    vi.mocked(apiGet).mockResolvedValue({ userId: "u 1" });

    await fetchQuotaUsage("u 1");

    expect(apiGet).toHaveBeenCalledWith("/api/admin/quota/usage/u%201");
  });

  it("adds an encoded endpoint query param", async () => {
    vi.mocked(apiGet).mockResolvedValue({});

    await fetchQuotaUsage("user-1", "/api/x");

    expect(apiGet).toHaveBeenCalledWith("/api/admin/quota/usage/user-1?endpoint=%2Fapi%2Fx");
  });

  it("maps 401/403/500 errors by rejecting with the ApiError", async () => {
    for (const status of [401, 403, 500]) {
      vi.mocked(apiGet).mockRejectedValueOnce(apiError(status));
      await expect(fetchQuotaUsage("user-1")).rejects.toMatchObject({ status });
    }
  });
});

describe("fetchQuotaOverrides", () => {
  it("unwraps the overrides array", async () => {
    const overrides = [{ userId: "u1", elevatedLimit: 10, reason: "vip", createdBy: "a", createdAt: 1 }];
    vi.mocked(apiGet).mockResolvedValue({ overrides });

    await expect(fetchQuotaOverrides("u1")).resolves.toEqual(overrides);
    expect(apiGet).toHaveBeenCalledWith("/api/admin/quota/overrides/u1");
  });

  it("rejects with the ApiError on 403", async () => {
    vi.mocked(apiGet).mockRejectedValue(apiError(403));

    await expect(fetchQuotaOverrides("u1")).rejects.toMatchObject({ status: 403 });
  });
});

describe("createQuotaOverride", () => {
  it("POSTs the params to /api/admin/quota/override", async () => {
    const params = { userId: "u1", elevatedLimit: 50, reason: "vip" };
    vi.mocked(apiPost).mockResolvedValue({ success: true, override: {} });

    await createQuotaOverride(params);

    expect(apiPost).toHaveBeenCalledWith("/api/admin/quota/override", params);
  });

  it("rejects with the ApiError on 500", async () => {
    vi.mocked(apiPost).mockRejectedValue(apiError(500));

    await expect(
      createQuotaOverride({ userId: "u1", elevatedLimit: 1, reason: "x" }),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe("removeQuotaOverride", () => {
  it("sends DELETE with userId and endpoint in the JSON body", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ success: true });

    await removeQuotaOverride("u1", "/api/x");

    expect(apiFetch).toHaveBeenCalledWith("/api/admin/quota/override", {
      method: "DELETE",
      body: JSON.stringify({ userId: "u1", endpoint: "/api/x" }),
    });
  });

  it("omits endpoint from the body when not given", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ success: true });

    await removeQuotaOverride("u1");

    expect(vi.mocked(apiFetch).mock.calls[0][1]?.body).toBe(JSON.stringify({ userId: "u1" }));
  });

  it("rejects with the ApiError on 401", async () => {
    vi.mocked(apiFetch).mockRejectedValue(apiError(401));

    await expect(removeQuotaOverride("u1")).rejects.toMatchObject({ status: 401 });
  });
});

describe("fetchQuotaStats", () => {
  it("GETs /api/admin/quota/stats", async () => {
    vi.mocked(apiGet).mockResolvedValue({ totalOverrides: 2, activeOverrides: 1 });

    await expect(fetchQuotaStats()).resolves.toEqual({ totalOverrides: 2, activeOverrides: 1 });
    expect(apiGet).toHaveBeenCalledWith("/api/admin/quota/stats");
  });

  it("rejects with the ApiError on 500", async () => {
    vi.mocked(apiGet).mockRejectedValue(apiError(500));

    await expect(fetchQuotaStats()).rejects.toMatchObject({ status: 500 });
  });
});

describe("resetQuota", () => {
  it("POSTs userId and endpoint to /api/admin/quota/reset", async () => {
    vi.mocked(apiPost).mockResolvedValue({ success: true });

    await resetQuota("u1", "/api/x");

    expect(apiPost).toHaveBeenCalledWith("/api/admin/quota/reset", { userId: "u1", endpoint: "/api/x" });
  });

  it("rejects with the ApiError on 403", async () => {
    vi.mocked(apiPost).mockRejectedValue(apiError(403));

    await expect(resetQuota("u1")).rejects.toMatchObject({ status: 403 });
  });
});
