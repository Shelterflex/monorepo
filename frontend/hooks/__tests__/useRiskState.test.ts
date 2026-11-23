import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRiskState } from "../useRiskState";

const mocks = vi.hoisted(() => ({
  fetchRiskState: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  onFinishHydration: vi.fn(),
  hasHydrated: vi.fn<() => boolean>(() => false),
  rehydrate: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  listener: null as (() => void) | null,
  hydrated: false,
  state: {
    isFrozen: false,
    freezeReason: null as string | null,
    deficitNgn: 0,
    updatedAt: null as string | null,
    isLoading: false,
  },
}));

vi.mock("@/store/useRiskStore", () => {
  const useRiskStore = Object.assign(
    vi.fn(() => ({ ...mocks.state, fetchRiskState: mocks.fetchRiskState })),
    {
      persist: {
        onFinishHydration: (listener: () => void) => {
          mocks.onFinishHydration(listener);
          mocks.listener = listener;
          return () => {
            mocks.listener = null;
          };
        },
        hasHydrated: () => mocks.hasHydrated(),
        rehydrate: () => mocks.rehydrate(),
      },
    },
  );

  return { default: useRiskStore };
});

describe("useRiskState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.hydrated = false;
    mocks.listener = null;
    mocks.state.isFrozen = false;
    mocks.state.freezeReason = null;
    mocks.state.deficitNgn = 0;
    mocks.state.updatedAt = null;
    mocks.state.isLoading = false;
    mocks.fetchRiskState.mockResolvedValue(undefined);
    mocks.rehydrate.mockResolvedValue(undefined);
    mocks.hasHydrated.mockImplementation(() => mocks.hydrated);
  });

  afterEach(() => {
    mocks.listener = null;
    vi.useRealTimers();
  });

  it("exposes hydrated risk state and refreshes through the store", async () => {
    mocks.hydrated = true;
    mocks.state.isFrozen = true;
    mocks.state.freezeReason = "Compliance Review";
    mocks.state.deficitNgn = 42000;
    mocks.state.updatedAt = "2026-01-01T00:00:00Z";

    const { result } = renderHook(() => useRiskState());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.hasHydrated).toBe(true);
    expect(result.current.isFrozen).toBe(true);
    expect(result.current.freezeReason).toBe("Compliance Review");
    expect(result.current.deficitNgn).toBe(42000);
    expect(result.current.updatedAt).toBe("2026-01-01T00:00:00Z");
    expect(result.current.isLoading).toBe(false);
    expect(mocks.rehydrate).not.toHaveBeenCalled();
    expect(mocks.fetchRiskState).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mocks.fetchRiskState).toHaveBeenCalledTimes(2);
  });

  it("loads risk state after delayed hydration", async () => {
    mocks.rehydrate.mockImplementation(async () => {
      mocks.hydrated = true;
      mocks.listener?.();
    });

    const { result } = renderHook(() => useRiskState());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.onFinishHydration).toHaveBeenCalledTimes(1);
    expect(mocks.rehydrate).toHaveBeenCalledTimes(1);
    expect(result.current.hasHydrated).toBe(true);
    expect(mocks.fetchRiskState).toHaveBeenCalledTimes(1);
  });

  it("treats a failed rehydration as hydrated and still loads state", async () => {
    mocks.rehydrate.mockImplementation(async () => {
      throw new Error("corrupt storage");
    });

    const { result } = renderHook(() => useRiskState());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.hasHydrated).toBe(true);
    expect(mocks.fetchRiskState).toHaveBeenCalledTimes(1);
    expect(result.current.isFrozen).toBe(false);
  });
});
