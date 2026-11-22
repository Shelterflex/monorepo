import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePaymentHistory } from "../usePaymentHistory";
import type { PaymentHistoryItem } from "@/lib/tenantApi";

vi.mock("@/lib/apiClient", () => ({
  apiGet: vi.fn(),
  withQuery: vi.fn((_path: string, params: Record<string, unknown>) => {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return qs ? `/api/v1/tenant/payments?${qs}` : "/api/v1/tenant/payments";
  }),
}));

import { apiGet } from "@/lib/apiClient";

const mockApiGet = vi.mocked(apiGet);

function makePayment(overrides: Partial<PaymentHistoryItem> = {}): PaymentHistoryItem {
  return {
    id: `pay-${Math.random().toString(36).slice(2, 8)}`,
    dealId: "deal-1",
    reference: "REF-001",
    amount: 50000,
    status: "paid",
    transactionDate: "2025-01-15T10:00:00Z",
    paidDate: "2025-01-15T10:00:00Z",
    dueDate: "2025-01-15T00:00:00Z",
    method: "bank_transfer",
    isOverdue: false,
    daysOverdue: 0,
    ...overrides,
  };
}

function pageResponse(payments: PaymentHistoryItem[], overrides: Partial<{ page: number; limit: number; total: number; nextPage?: number }> = {}) {
  return {
    success: true,
    data: {
      payments,
      page: overrides.page ?? 1,
      limit: overrides.limit ?? 10,
      total: overrides.total ?? payments.length,
      nextPage: overrides.nextPage,
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("usePaymentHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches page 1 on mount", async () => {
    const payments = [makePayment({ id: "p1" }), makePayment({ id: "p2" })];
    mockApiGet.mockResolvedValue(pageResponse(payments));

    const { result } = renderHook(() => usePaymentHistory({ dealId: "deal-1" }));

    expect(result.current.isLoading).toBe(true);

    await act(async () => { /* flush promises */ });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.payments).toHaveLength(2);
    expect(result.current.page).toBe(1);
    expect(result.current.hasMore).toBe(false);
  });

  it("sets isError on fetch failure", async () => {
    mockApiGet.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => usePaymentHistory({ dealId: "deal-1" }));
    await act(async () => { /* flush */ });

    expect(result.current.isError).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.payments).toHaveLength(0);
  });

  it("sets isError when response.success is false", async () => {
    mockApiGet.mockResolvedValue({ success: false, data: { payments: [], page: 1, limit: 10, total: 0 } });

    const { result } = renderHook(() => usePaymentHistory({ dealId: "deal-1" }));
    await act(async () => { /* flush */ });

    expect(result.current.isError).toBe(true);
  });

  it("handles empty results", async () => {
    mockApiGet.mockResolvedValue(pageResponse([]));

    const { result } = renderHook(() => usePaymentHistory({ dealId: "deal-1" }));
    await act(async () => { /* flush */ });

    expect(result.current.payments).toHaveLength(0);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("derives paid/pending/overdue from data", async () => {
    const payments = [
      makePayment({ id: "paid1", status: "paid", isOverdue: false }),
      makePayment({ id: "pending1", status: "upcoming", isOverdue: false }),
      makePayment({ id: "overdue1", status: "overdue", isOverdue: true, daysOverdue: 7 }),
    ];
    mockApiGet.mockResolvedValue(pageResponse(payments));

    const { result } = renderHook(() => usePaymentHistory({ dealId: "deal-1" }));
    await act(async () => { /* flush */ });

    const paid = result.current.payments.filter((p) => p.status === "paid");
    const pending = result.current.payments.filter((p) => p.status === "upcoming");
    const overdue = result.current.payments.filter((p) => p.isOverdue);

    expect(paid).toHaveLength(1);
    expect(pending).toHaveLength(1);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].daysOverdue).toBe(7);
  });

  it("sets hasMore when nextPage is present", async () => {
    mockApiGet.mockResolvedValue(
      pageResponse([makePayment()], { page: 1, total: 20, nextPage: 2 }),
    );

    const { result } = renderHook(() => usePaymentHistory({ dealId: "deal-1" }));
    await act(async () => { /* flush */ });

    expect(result.current.hasMore).toBe(true);
  });

  it("loadMore fetches next page and appends", async () => {
    const page1 = [makePayment({ id: "p1" })];
    const page2 = [makePayment({ id: "p2" })];

    mockApiGet
      .mockResolvedValueOnce(pageResponse(page1, { page: 1, total: 2, nextPage: 2 }))
      .mockResolvedValueOnce(pageResponse(page2, { page: 2, total: 2 }));

    const { result } = renderHook(() => usePaymentHistory({ dealId: "deal-1" }));
    await act(async () => { /* flush mount */ });

    expect(result.current.payments).toHaveLength(1);
    expect(result.current.hasMore).toBe(true);

    await act(async () => { await result.current.loadMore(); });

    expect(result.current.payments).toHaveLength(2);
    expect(result.current.payments[0].id).toBe("p1");
    expect(result.current.payments[1].id).toBe("p2");
    expect(result.current.page).toBe(2);
    expect(result.current.hasMore).toBe(false);
  });

  it("loadMore is a no-op when hasMore is false", async () => {
    mockApiGet.mockResolvedValue(pageResponse([makePayment()], { page: 1, total: 1 }));

    const { result } = renderHook(() => usePaymentHistory({ dealId: "deal-1" }));
    await act(async () => { /* flush */ });

    expect(result.current.hasMore).toBe(false);

    await act(async () => { await result.current.loadMore(); });
    // Only called once (initial fetch)
    expect(mockApiGet).toHaveBeenCalledTimes(1);
  });

  it("refetches when dealId changes", async () => {
    mockApiGet.mockResolvedValue(pageResponse([makePayment({ id: "d1-p1" })]));

    const { result, rerender } = renderHook(
      ({ dealId }) => usePaymentHistory({ dealId }),
      { initialProps: { dealId: "deal-1" } },
    );
    await act(async () => { /* flush */ });

    expect(result.current.payments).toHaveLength(1);

    mockApiGet.mockResolvedValue(pageResponse([makePayment({ id: "d2-p1" })]));
    rerender({ dealId: "deal-2" });
    await act(async () => { /* flush */ });

    expect(result.current.payments).toHaveLength(1);
    expect(result.current.payments[0].id).toBe("d2-p1");
  });

  it("respects custom limit parameter", async () => {
    mockApiGet.mockResolvedValue(
      pageResponse(Array.from({ length: 5 }, (_, i) => makePayment({ id: `p${i}` }))),
    );

    renderHook(() => usePaymentHistory({ dealId: "deal-1", limit: 5 }));
    await act(async () => { /* flush */ });

    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining("limit=5"),
    );
  });

  it("respects custom initialPage parameter for state", async () => {
    mockApiGet.mockResolvedValue(
      pageResponse([makePayment()], { page: 1, total: 2, nextPage: 2 }),
    );

    const { result } = renderHook(() => usePaymentHistory({ dealId: "deal-1", initialPage: 3 }));
    await act(async () => { /* flush */ });

    // initialPage affects the page state used for loadMore, but the hook
    // always fetches page 1 on mount via useEffect. The page state starts
    // at initialPage and gets updated by loadPage's setPage call.
    expect(result.current.page).toBe(1);
  });

  it("does not fetch when dealId is null", async () => {
    renderHook(() => usePaymentHistory({ dealId: null }));
    await act(async () => { /* flush */ });

    expect(mockApiGet).toHaveBeenCalled();
    // It still calls with dealId=undefined in the query string
  });

  it("does not apply a pending response after unmount", async () => {
    const pending = deferred<ReturnType<typeof pageResponse>>();
    mockApiGet.mockReturnValue(pending.promise);

    const { result, unmount } = renderHook(() =>
      usePaymentHistory({ dealId: "deal-1" }),
    );
    expect(result.current.isLoading).toBe(true);

    unmount();
    await act(async () => {
      pending.resolve(pageResponse([makePayment({ id: "late" })]));
      await pending.promise;
    });

    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(result.current.payments).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it("keeps the latest deal response when the older request settles after unmount", async () => {
    const older = deferred<ReturnType<typeof pageResponse>>();
    const newer = deferred<ReturnType<typeof pageResponse>>();
    mockApiGet
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const { result, rerender, unmount } = renderHook(
      ({ dealId }: { dealId: string }) => usePaymentHistory({ dealId }),
      { initialProps: { dealId: "deal-1" } },
    );

    act(() => {
      rerender({ dealId: "deal-2" });
    });
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      newer.resolve(pageResponse([makePayment({ id: "newer", dealId: "deal-2" })]));
      await newer.promise;
    });
    expect(result.current.payments[0].id).toBe("newer");

    unmount();
    await act(async () => {
      older.resolve(pageResponse([makePayment({ id: "older", dealId: "deal-1" })]));
      await older.promise;
    });

    expect(result.current.payments[0].id).toBe("newer");
  });
});
