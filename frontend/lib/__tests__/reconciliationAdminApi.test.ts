import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchAgingSummary,
  fetchMismatches,
  closeMismatch,
  runReconciliation,
  fetchEventDrilldown,
} from "@/lib/api/reconciliation";
import { ApiError } from "@/lib/api";

vi.mock("@/lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apiClient")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

import { apiGet, apiPost } from "@/lib/apiClient";

const BASE = "/api/v1/admin/reconciliation";
const apiError = (status: number) => new ApiError({ message: `HTTP ${status}`, status });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchAgingSummary", () => {
  it("GETs the aging route", async () => {
    vi.mocked(apiGet).mockResolvedValue({ totalMismatches: 0 });

    await fetchAgingSummary();

    expect(apiGet).toHaveBeenCalledWith(`${BASE}/aging`);
  });

  it("rejects with the ApiError on 401", async () => {
    vi.mocked(apiGet).mockRejectedValue(apiError(401));

    await expect(fetchAgingSummary()).rejects.toMatchObject({ status: 401 });
  });
});

describe("fetchMismatches", () => {
  it("GETs mismatches with no query when no filters are given", async () => {
    vi.mocked(apiGet).mockResolvedValue([]);

    await fetchMismatches();

    expect(apiGet).toHaveBeenCalledWith(`${BASE}/mismatches`);
  });

  it("adds status and class filters to the query string", async () => {
    vi.mocked(apiGet).mockResolvedValue([]);

    await fetchMismatches({ status: "OPEN", class: "amount" });

    expect(apiGet).toHaveBeenCalledWith(`${BASE}/mismatches?status=OPEN&class=amount`);
  });

  it("rejects with the ApiError on 403", async () => {
    vi.mocked(apiGet).mockRejectedValue(apiError(403));

    await expect(fetchMismatches()).rejects.toMatchObject({ status: 403 });
  });
});

describe("closeMismatch", () => {
  it("POSTs the reason to the mismatch's close route", async () => {
    vi.mocked(apiPost).mockResolvedValue({});

    await closeMismatch("m-1", "duplicate");

    expect(apiPost).toHaveBeenCalledWith(`${BASE}/mismatches/m-1/close`, { reason: "duplicate" });
  });

  it("rejects with the ApiError on 500", async () => {
    vi.mocked(apiPost).mockRejectedValue(apiError(500));

    await expect(closeMismatch("m-1", "x")).rejects.toMatchObject({ status: 500 });
  });
});

describe("runReconciliation", () => {
  it("POSTs an empty body to the run route and returns the result", async () => {
    const result = { runId: "r1", processedCount: 4, mismatchesFound: 1, timestamp: "t" };
    vi.mocked(apiPost).mockResolvedValue(result);

    await expect(runReconciliation()).resolves.toEqual(result);
    expect(apiPost).toHaveBeenCalledWith(`${BASE}/run`, {});
  });

  it("rejects with the ApiError on 500", async () => {
    vi.mocked(apiPost).mockRejectedValue(apiError(500));

    await expect(runReconciliation()).rejects.toMatchObject({ status: 500 });
  });
});

describe("fetchEventDrilldown", () => {
  it("GETs the events route for the mismatch", async () => {
    vi.mocked(apiGet).mockResolvedValue({ ledgerEvent: {}, providerEvent: {} });

    await fetchEventDrilldown("m-1");

    expect(apiGet).toHaveBeenCalledWith(`${BASE}/mismatches/m-1/events`);
  });

  it("rejects with the ApiError on 403", async () => {
    vi.mocked(apiGet).mockRejectedValue(apiError(403));

    await expect(fetchEventDrilldown("m-1")).rejects.toMatchObject({ status: 403 });
  });
});
