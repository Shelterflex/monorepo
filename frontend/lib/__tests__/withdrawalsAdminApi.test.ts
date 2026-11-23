import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchWithdrawals, approveWithdrawal, rejectWithdrawal } from "@/lib/api/withdrawals";
import { ApiError } from "@/lib/api";

vi.mock("@/lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apiClient")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

import { apiGet, apiPost } from "@/lib/apiClient";

const apiError = (status: number) => new ApiError({ message: `HTTP ${status}`, status });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchWithdrawals", () => {
  it("requests page 1 with no status filter by default", async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await fetchWithdrawals();

    expect(apiGet).toHaveBeenCalledWith("/admin/withdrawals?page=1");
  });

  it("omits the status filter when it is 'all'", async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await fetchWithdrawals("all", 3);

    expect(apiGet).toHaveBeenCalledWith("/admin/withdrawals?page=3");
  });

  it("sends the status filter and page", async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: [], total: 0, page: 2, limit: 20 });

    await fetchWithdrawals("pending", 2);

    expect(apiGet).toHaveBeenCalledWith("/admin/withdrawals?status=pending&page=2");
  });

  it("rejects with the ApiError on 401, 403 and 500", async () => {
    for (const status of [401, 403, 500]) {
      vi.mocked(apiGet).mockRejectedValueOnce(apiError(status));
      await expect(fetchWithdrawals()).rejects.toMatchObject({ status });
    }
  });
});

describe("approveWithdrawal", () => {
  it("POSTs an empty body to the approve route", async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: "w1", status: "approved" });

    await expect(approveWithdrawal("w1")).resolves.toMatchObject({ status: "approved" });
    expect(apiPost).toHaveBeenCalledWith("/admin/withdrawals/w1/approve", {});
  });

  it("rejects with the ApiError on 403", async () => {
    vi.mocked(apiPost).mockRejectedValue(apiError(403));

    await expect(approveWithdrawal("w1")).rejects.toMatchObject({ status: 403 });
  });
});

describe("rejectWithdrawal", () => {
  it("POSTs the reason to the reject route", async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: "w1", status: "rejected" });

    await expect(rejectWithdrawal("w1", "bad account")).resolves.toMatchObject({ status: "rejected" });
    expect(apiPost).toHaveBeenCalledWith("/admin/withdrawals/w1/reject", { reason: "bad account" });
  });

  it("rejects with the ApiError on 500", async () => {
    vi.mocked(apiPost).mockRejectedValue(apiError(500));

    await expect(rejectWithdrawal("w1", "x")).rejects.toMatchObject({ status: 500 });
  });
});
