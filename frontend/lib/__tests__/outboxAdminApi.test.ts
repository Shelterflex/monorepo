import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchDeadLetterItems,
  retryDeadLetterItem,
  bulkRetryDeadLetters,
  dismissDeadLetterItem,
} from "../outboxAdminApi";
import { ApiError } from "../api";

vi.mock("../apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apiClient")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet, apiPost, apiDelete } from "../apiClient";

const apiError = (status: number) => new ApiError({ message: `HTTP ${status}`, status });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchDeadLetterItems", () => {
  it("GETs the dead-letter route with no query by default", async () => {
    vi.mocked(apiGet).mockResolvedValue({ items: [], pagination: {} });

    await fetchDeadLetterItems();

    expect(apiGet).toHaveBeenCalledWith("/api/admin/outbox/dead-letter");
  });

  it("adds every filter to the query string", async () => {
    vi.mocked(apiGet).mockResolvedValue({ items: [], pagination: {} });

    await fetchDeadLetterItems({
      page: 2,
      pageSize: 10,
      eventType: "payment",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });

    expect(apiGet).toHaveBeenCalledWith(
      "/api/admin/outbox/dead-letter?page=2&pageSize=10&eventType=payment&dateFrom=2026-01-01&dateTo=2026-01-31",
    );
  });

  it("rejects with the ApiError on 401, 403 and 500", async () => {
    for (const status of [401, 403, 500]) {
      vi.mocked(apiGet).mockRejectedValueOnce(apiError(status));
      await expect(fetchDeadLetterItems()).rejects.toMatchObject({ status });
    }
  });
});

describe("retryDeadLetterItem", () => {
  it("POSTs an empty body to the item's retry route", async () => {
    vi.mocked(apiPost).mockResolvedValue({ success: true, message: "ok" });

    await retryDeadLetterItem("dl-1");

    expect(apiPost).toHaveBeenCalledWith("/api/admin/outbox/dead-letter/dl-1/retry", {});
  });

  it("rejects with the ApiError on 500", async () => {
    vi.mocked(apiPost).mockRejectedValue(apiError(500));

    await expect(retryDeadLetterItem("dl-1")).rejects.toMatchObject({ status: 500 });
  });
});

describe("bulkRetryDeadLetters", () => {
  it("POSTs the event type to the bulk-retry route", async () => {
    vi.mocked(apiPost).mockResolvedValue({ success: true, reQueued: 3, message: "ok" });

    await expect(bulkRetryDeadLetters("payment")).resolves.toMatchObject({ reQueued: 3 });
    expect(apiPost).toHaveBeenCalledWith("/api/admin/outbox/dead-letter/bulk-retry", {
      eventType: "payment",
    });
  });

  it("rejects with the ApiError on 403", async () => {
    vi.mocked(apiPost).mockRejectedValue(apiError(403));

    await expect(bulkRetryDeadLetters("payment")).rejects.toMatchObject({ status: 403 });
  });
});

describe("dismissDeadLetterItem", () => {
  it("DELETEs the item's dead-letter route", async () => {
    vi.mocked(apiDelete).mockResolvedValue({ success: true, message: "dismissed" });

    await expect(dismissDeadLetterItem("dl-1")).resolves.toMatchObject({ success: true });
    expect(apiDelete).toHaveBeenCalledWith("/api/admin/outbox/dead-letter/dl-1");
  });

  it("rejects with the ApiError on 401", async () => {
    vi.mocked(apiDelete).mockRejectedValue(apiError(401));

    await expect(dismissDeadLetterItem("dl-1")).rejects.toMatchObject({ status: 401 });
  });
});
