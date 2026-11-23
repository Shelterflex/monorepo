import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import usePreferencesStore from "../usePreferencesStore";

function resetStore() {
  usePreferencesStore.setState({
    theme: "system",
    currency: "NGN",
    language: "en",
    notificationsEnabled: true,
    compactView: false,
    lastSyncedAt: null,
    isDirty: false,
  });
}

describe("usePreferencesStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    act(() => {
      resetStore();
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      resetStore();
    });
    localStorage.clear();
    vi.useRealTimers();
  });

  it("starts with defaults and marks preference changes dirty", () => {
    const { result } = renderHook(() => usePreferencesStore());

    expect(result.current.theme).toBe("system");
    expect(result.current.currency).toBe("NGN");
    expect(result.current.lastSyncedAt).toBeNull();
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.setPreference("theme", "dark");
    });

    expect(result.current.theme).toBe("dark");
    expect(result.current.isDirty).toBe(true);
  });

  it("merges newer server preferences and ignores older ones", () => {
    const { result } = renderHook(() => usePreferencesStore());

    act(() => {
      result.current.markSynced("2026-01-01T00:00:00Z");
    });
    expect(result.current.isDirty).toBe(false);
    expect(result.current.lastSyncedAt).toBe("2026-01-01T00:00:00Z");

    act(() => {
      result.current.setPreference("currency", "USD");
    });
    act(() => {
      result.current.mergeServerPreferences(
        { currency: "EUR", language: "fr" },
        "2026-02-01T00:00:00Z",
      );
    });

    expect(result.current.currency).toBe("EUR");
    expect(result.current.language).toBe("fr");
    expect(result.current.lastSyncedAt).toBe("2026-02-01T00:00:00Z");
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.mergeServerPreferences(
        { currency: "GBP" },
        "2025-01-01T00:00:00Z",
      );
    });
    expect(result.current.currency).toBe("EUR");
  });

  it("resets all preferences to defaults", () => {
    const { result } = renderHook(() => usePreferencesStore());

    act(() => {
      result.current.setPreference("compactView", true);
      result.current.markSynced("2026-03-01T00:00:00Z");
    });
    act(() => {
      result.current.reset();
    });

    expect(result.current).toEqual(
      expect.objectContaining({
        theme: "system",
        currency: "NGN",
        compactView: false,
        lastSyncedAt: null,
        isDirty: false,
      }),
    );
  });

  it("persists only user preferences and sync metadata", () => {
    const { result } = renderHook(() => usePreferencesStore());

    act(() => {
      result.current.setPreference("notificationsEnabled", false);
      result.current.setPreference("compactView", true);
    });

    const stored = JSON.parse(
      localStorage.getItem("shelterflex-preferences-storage")!,
    );

    expect(stored.version).toBe(1);
    expect(stored.state).toEqual(
      expect.objectContaining({
        theme: "system",
        notificationsEnabled: false,
        compactView: true,
        lastSyncedAt: null,
      }),
    );
    expect(stored.state.isDirty).toBeUndefined();
    expect(stored.state.setPreference).toBeUndefined();
  });

  it("rehydrates persisted preferences", async () => {
    localStorage.setItem(
      "shelterflex-preferences-storage",
      JSON.stringify({
        version: 1,
        state: {
          theme: "dark",
          currency: "USD",
          language: "en",
          notificationsEnabled: false,
          compactView: true,
          lastSyncedAt: "2026-01-01T00:00:00Z",
        },
      }),
    );

    await act(async () => {
      await usePreferencesStore.persist.rehydrate();
    });

    expect(usePreferencesStore.getState().theme).toBe("dark");
    expect(usePreferencesStore.getState().currency).toBe("USD");
    expect(usePreferencesStore.getState().compactView).toBe(true);
    expect(usePreferencesStore.getState().lastSyncedAt).toBe(
      "2026-01-01T00:00:00Z",
    );
  });

  it("keeps defaults when persisted data is corrupted", async () => {
    localStorage.setItem("shelterflex-preferences-storage", "not-json");

    await act(async () => {
      await usePreferencesStore.persist.rehydrate();
    });

    expect(usePreferencesStore.getState().theme).toBe("system");
    expect(usePreferencesStore.getState().currency).toBe("NGN");
    expect(usePreferencesStore.getState().isDirty).toBe(false);
  });
});
