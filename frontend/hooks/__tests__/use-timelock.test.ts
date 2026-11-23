import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTimelock, useCountdown } from "../useTimelock";
import type { QueuedTransaction } from "@/lib/timelockApi";

vi.mock("@/lib/timelockApi", () => ({
  getQueuedTransactions: vi.fn(),
  executeTransaction: vi.fn(),
  cancelTransaction: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  handleError: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { getQueuedTransactions, executeTransaction, cancelTransaction } from "@/lib/timelockApi";
import { handleError, showSuccessToast } from "@/lib/toast";

const mockGetQueued = vi.mocked(getQueuedTransactions);
const mockExecute = vi.mocked(executeTransaction);
const mockCancel = vi.mocked(cancelTransaction);
const mockHandleError = vi.mocked(handleError);
const mockShowSuccess = vi.mocked(showSuccessToast);

function makeTx(overrides: Partial<QueuedTransaction> = {}): QueuedTransaction {
  return {
    txHash: "abc123",
    target: "GA1234",
    functionName: "transfer",
    args: [],
    eta: Math.floor(Date.now() / 1000) + 3600,
    status: "queued",
    ledger: 100,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useTimelock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockGetQueued.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads queued transactions on mount", async () => {
    const txs = [makeTx(), makeTx({ txHash: "def456" })];
    mockGetQueued.mockResolvedValue(txs);

    const { result } = renderHook(() => useTimelock());

    expect(result.current.isLoading).toBe(true);

    await act(async () => { /* flush promises */ });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.queuedTransactions).toHaveLength(2);
    expect(mockGetQueued).toHaveBeenCalledTimes(1);
  });

  it("sets error state on fetch failure", async () => {
    mockGetQueued.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useTimelock());

    await act(async () => { /* flush promises */ });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.queuedTransactions).toHaveLength(0);
    expect(mockHandleError).toHaveBeenCalled();
  });

  it("polls every 10 seconds", async () => {
    mockGetQueued.mockResolvedValue([makeTx()]);

    renderHook(() => useTimelock());

    await act(async () => { /* flush mount */ });
    expect(mockGetQueued).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(mockGetQueued).toHaveBeenCalledTimes(2);

    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(mockGetQueued).toHaveBeenCalledTimes(3);
  });

  it("cleans up poll interval on unmount", async () => {
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");

    const { unmount } = renderHook(() => useTimelock());
    await act(async () => { /* flush mount */ });

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("execute calls API and refreshes list", async () => {
    mockExecute.mockResolvedValue({ success: true });
    mockGetQueued.mockResolvedValue([makeTx({ txHash: "exec1" })]);

    const { result } = renderHook(() => useTimelock());
    await act(async () => { /* flush mount */ });

    mockGetQueued.mockResolvedValue([]);
    await act(async () => { await result.current.handleExecute("exec1"); });

    expect(mockExecute).toHaveBeenCalledWith("exec1");
    expect(mockShowSuccess).toHaveBeenCalledWith("Transaction executed successfully");
  });

  it("execute handles errors", async () => {
    mockExecute.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useTimelock());
    await act(async () => { /* flush mount */ });

    await act(async () => { await result.current.handleExecute("tx1"); });

    expect(mockHandleError).toHaveBeenCalled();
  });

  it("does not refresh or toast when execute reports failure", async () => {
    mockExecute.mockResolvedValue({ success: false });

    const { result } = renderHook(() => useTimelock());
    await act(async () => {});

    mockGetQueued.mockClear();
    await act(async () => { await result.current.handleExecute("tx1"); });

    expect(mockShowSuccess).not.toHaveBeenCalled();
    expect(mockHandleError).not.toHaveBeenCalled();
    expect(mockGetQueued).not.toHaveBeenCalled();
  });

  it("cancel calls API and refreshes list", async () => {
    mockCancel.mockResolvedValue({ success: true });
    mockGetQueued.mockResolvedValue([makeTx({ txHash: "c1" })]);

    const { result } = renderHook(() => useTimelock());
    await act(async () => { /* flush mount */ });

    mockGetQueued.mockResolvedValue([]);
    await act(async () => { await result.current.handleCancel("c1"); });

    expect(mockCancel).toHaveBeenCalledWith("c1");
    expect(mockShowSuccess).toHaveBeenCalledWith("Transaction cancelled successfully");
  });

  it("cancel handles errors", async () => {
    mockCancel.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useTimelock());
    await act(async () => { /* flush mount */ });

    await act(async () => { await result.current.handleCancel("tx1"); });

    expect(mockHandleError).toHaveBeenCalled();
  });

  it("does not refresh or toast when cancel reports failure", async () => {
    mockCancel.mockResolvedValue({ success: false });

    const { result } = renderHook(() => useTimelock());
    await act(async () => {});

    mockGetQueued.mockClear();
    await act(async () => { await result.current.handleCancel("tx1"); });

    expect(mockShowSuccess).not.toHaveBeenCalled();
    expect(mockHandleError).not.toHaveBeenCalled();
    expect(mockGetQueued).not.toHaveBeenCalled();
  });
});

describe("useCountdown (timelock variant)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows time left from eta", () => {
    const eta = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now

    const { result } = renderHook(() => useCountdown(eta));
    expect(result.current.timeLeft).toBe(7200);
    expect(result.current.formatTime()).toBe("2h 0m 0s");
  });

  it("shows Ready to Execute when eta is in the past", () => {
    const eta = Math.floor(Date.now() / 1000) - 3600;

    const { result } = renderHook(() => useCountdown(eta));
    expect(result.current.timeLeft).toBe(0);
    expect(result.current.formatTime()).toBe("Ready to Execute");
  });

  it("shows Ready to Execute when eta is zero", () => {
    const { result } = renderHook(() => useCountdown(0));
    expect(result.current.timeLeft).toBe(0);
    expect(result.current.formatTime()).toBe("Ready to Execute");
  });

  it("counts down over time", () => {
    const now = Math.floor(Date.now() / 1000);
    const eta = now + 120; // 2 minutes from now

    const { result } = renderHook(() => useCountdown(eta));
    expect(result.current.timeLeft).toBe(120);

    act(() => { vi.advanceTimersByTime(30000); }); // +30s
    expect(result.current.timeLeft).toBe(90);
    expect(result.current.formatTime()).toBe("0h 1m 30s");

    act(() => { vi.advanceTimersByTime(60000); }); // +60s
    expect(result.current.timeLeft).toBe(30);
    expect(result.current.formatTime()).toBe("0h 0m 30s");

    act(() => { vi.advanceTimersByTime(30000); }); // +30s -> 0
    expect(result.current.timeLeft).toBe(0);
    expect(result.current.formatTime()).toBe("Ready to Execute");
  });

  it("transitions across the eta boundary", () => {
    const eta = Math.floor(Date.now() / 1000) + 2;

    const { result } = renderHook(() => useCountdown(eta));
    expect(result.current.timeLeft).toBe(2);

    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.timeLeft).toBe(0);
    expect(result.current.formatTime()).toBe("Ready to Execute");
  });

  it("cleans up interval on unmount", () => {
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    const { unmount } = renderHook(() => useCountdown(Math.floor(Date.now() / 1000) + 60));

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("handles negative eta", () => {
    const { result } = renderHook(() => useCountdown(-100));
    expect(result.current.timeLeft).toBe(0);
    expect(result.current.formatTime()).toBe("Ready to Execute");
  });

  it("recomputes after the eta changes", () => {
    const now = Math.floor(Date.now() / 1000);
    const { result, rerender } = renderHook(
      ({ eta }: { eta: number }) => useCountdown(eta),
      { initialProps: { eta: now + 60 } },
    );

    expect(result.current.timeLeft).toBe(60);

    rerender({ eta: now + 120 });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(result.current.timeLeft).toBe(119);
    expect(result.current.formatTime()).toBe("0h 1m 59s");
  });
});
