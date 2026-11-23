import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAuditLogs } from "../auditLogsApi";
import { ApiError } from "../api";

vi.mock("../apiClient", () => ({
  apiGet: vi.fn(),
}));

import { apiGet } from "../apiClient";

const apiError = (status: number) => new ApiError({ message: `HTTP ${status}`, status });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAuditLogs", () => {
  it("requests the v1 audit-logs route with no query when called without params", async () => {
    const response = { entries: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } };
    vi.mocked(apiGet).mockResolvedValue(response);

    await expect(getAuditLogs()).resolves.toEqual(response);
    expect(apiGet).toHaveBeenCalledWith("/api/v1/admin/audit-logs");
  });

  it("builds the query string from every filter, skipping empty values", async () => {
    vi.mocked(apiGet).mockResolvedValue({ entries: [], pagination: {} });

    await getAuditLogs({
      actorId: "user-1",
      action: "USER_LOGIN",
      resourceType: "deal",
      resourceId: "deal-9",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      page: 2,
      limit: 50,
    });

    expect(apiGet).toHaveBeenCalledWith(
      "/api/v1/admin/audit-logs?actorId=user-1&action=USER_LOGIN&resourceType=deal&resourceId=deal-9&startDate=2026-01-01&endDate=2026-02-01&page=2&limit=50",
    );
  });

  it("keeps page 0 and omits empty strings", async () => {
    vi.mocked(apiGet).mockResolvedValue({ entries: [], pagination: {} });

    await getAuditLogs({ actorId: "", page: 0 });

    expect(apiGet).toHaveBeenCalledWith("/api/v1/admin/audit-logs?page=0");
  });

  it("rejects with the ApiError for 401, 403 and 500", async () => {
    for (const status of [401, 403, 500]) {
      vi.mocked(apiGet).mockRejectedValueOnce(apiError(status));
      await expect(getAuditLogs()).rejects.toMatchObject({ status });
    }
  });
});
