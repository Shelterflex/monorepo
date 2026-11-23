import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePaymentHistory } from "../usePaymentHistory";
import type { PaymentHistoryItem } from "@/lib/tenantApi";

vi.mock("@/lib/apiClient", () => ({
  apiGet: vi.fn(),
  withQuery: vi.fn(
    (path: string, params: Record<string, unknown>) => {
      const query = Object.entries(params)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${value}`)
        .join("&");

      return query ? `${path}?${query}` : path;
    },
  ),
}));

import { apiGet } from "@/lib/apiClient";

const mockApiGet = vi.mocked(apiGet);

function makePayment(id: string, dealId: string): PaymentHistoryItem {
  return {
    id,
    dealId,
    reference: `REF-${id}`,
    amount: 50_000,
    status: "paid",
    transactionDate: "2025-01-15T10:00:00Z",
    paidDate: "2025-01-15T10:00:00Z",
    dueDate: "2025-01-15T00:00:00Z",
    method: "bank_transfer",
    isOverdue: false,
    daysOverdue: 0,
  };
}

function response(
  payments: PaymentHistoryItem[],
  page = 1,
  nextPage?: number,
) {
  return {
    success: true,
    data: {
      payments,
      page,
      limit: 10,
      total: payments.length,
      nextPage,
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

describe("usePaymentHistory input and callback behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("progresses from loading to success and refetches when dealId changes", async () => {
    mockApiGet
      .mockResolvedValueOnce(response([makePayment("p1", "deal-1")]))
      .mockResolvedValueOnce(response([makePayment("p2", "deal-2")]));

    const { result, rerender } = renderHook(
      ({ dealId }: { dealId: string }) => usePaymentHistory({ dealId }),
      { initialProps: { dealId: "deal-1" } },
    );

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.payments).toEqual([
      expect.objectContaining({ id: "p1", dealId: "deal-1" }),
    ]);
    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockApiGet).toHaveBeenLastCalledWith(
      "/api/v1/tenant/payments?dealId=deal-1&page=1&limit=10",
    );

    rerender({ dealId: "deal-2" });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockApiGet).toHaveBeenCalledTimes(2);
    expect(mockApiGet).toHaveBeenLastCalledWith(
      "/api/v1/tenant/payments?dealId=deal-2&page=1&limit=10",
    );
    expect(result.current.payments).toEqual([
      expect.objectContaining({ id: "p2", dealId: "deal-2" }),
    ]);
  });

  it("uses the current page when the returned loadMore callback is invoked", async () => {
    mockApiGet
      .mockResolvedValueOnce(
        response([makePayment("p1", "deal-1")], 1, 2),
      )
      .mockResolvedValueOnce(response([makePayment("p2", "deal-1")], 2));

    const { result } = renderHook(() =>
      usePaymentHistory({ dealId: "deal-1" }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockApiGet).toHaveBeenLastCalledWith(
      "/api/v1/tenant/payments?dealId=deal-1&page=2&limit=10",
    );
    expect(result.current.page).toBe(2);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.payments.map((payment) => payment.id)).toEqual([
      "p1",
      "p2",
    ]);
  });

  it("does not append a loadMore response that settles after unmount", async () => {
    const first = deferred<ReturnType<typeof response>>();
    const second = deferred<ReturnType<typeof response>>();
    mockApiGet
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, unmount } = renderHook(() =>
      usePaymentHistory({ dealId: "deal-1" }),
    );
    await act(async () => {
      first.resolve(response([makePayment("p1", "deal-1")], 1, 2));
      await first.promise;
    });

    expect(result.current.hasMore).toBe(true);

    act(() => {
      void result.current.loadMore();
    });
    unmount();

    await act(async () => {
      second.resolve(response([makePayment("p2", "deal-1")], 2));
      await second.promise;
      await Promise.resolve();
    });

    expect(mockApiGet).toHaveBeenCalledTimes(2);
    expect(result.current.payments.map((payment) => payment.id)).toEqual([
      "p1",
    ]);
  });
});
