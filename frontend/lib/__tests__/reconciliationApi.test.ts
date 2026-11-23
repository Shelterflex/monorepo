import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getOutboxItems,
  retryOutboxItem,
  retryAllOutboxItems,
} from "../reconciliationApi";
import { ApiError } from "../api";

vi.mock("../apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apiClient")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

import { apiGet, apiPost } from "../apiClient";

const apiError = (status: number) => new ApiError({ message: `HTTP ${status}`, status });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOutboxItems", () => {
  it("GETs /api/admin/outbox with no query when no params are given", async () => {
    vi.mocked(apiGet).mockResolvedValue({ items: [], total: 0 });

    await expect(getOutboxItems()).resolves.toEqual({ items: [], total: 0 });
    expect(apiGet).toHaveBeenCalledWith("/api/admin/outbox");
  });

  it("adds status and limit to the query string", async () => {
    vi.mocked(apiGet).mockResolvedValue({ items: [], total: 0 });

    await getOutboxItems({ status: "failed", limit: 25 });

    expect(apiGet).toHaveBeenCalledWith("/api/admin/outbox?status=failed&limit=25");
  });

  it("rejects with the ApiError on 401, 403 and 500", async () => {
    for (const status of [401, 403, 500]) {
      vi.mocked(apiGet).mockRejectedValueOnce(apiError(status));
      await expect(getOutboxItems()).rejects.toMatchObject({ status });
    }
  });
});

describe("retryOutboxItem", () => {
  it("POSTs an empty body to the item retry route", async () => {
    vi.mocked(apiPost).mockResolvedValue({ success: true });

    await retryOutboxItem("item-1");

    expect(apiPost).toHaveBeenCalledWith("/api/admin/outbox/item-1/retry", {});
  });

  it("rejects with the ApiError on 500", async () => {
    vi.mocked(apiPost).mockRejectedValue(apiError(500));

    await expect(retryOutboxItem("item-1")).rejects.toMatchObject({ status: 500 });
  });
});

describe("retryAllOutboxItems", () => {
  it("POSTs an empty body to the retry-all route", async () => {
    vi.mocked(apiPost).mockResolvedValue({ success: true, succeeded: 2, failed: 0, message: "ok" });

    await expect(retryAllOutboxItems()).resolves.toMatchObject({ succeeded: 2 });
    expect(apiPost).toHaveBeenCalledWith("/api/admin/outbox/retry-all", {});
  });

  it("rejects with the ApiError on 403", async () => {
    vi.mocked(apiPost).mockRejectedValue(apiError(403));

    await expect(retryAllOutboxItems()).rejects.toMatchObject({ status: 403 });
  });
});
