import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDraftPersist } from "../useDraftPersist";

describe("useDraftPersist", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("debounces saves, loads the draft, and clears it", () => {
    const { result } = renderHook(() => useDraftPersist<{ title: string }>("draft-key"));

    expect(result.current.load()).toBeNull();

    act(() => {
      result.current.save({ title: "first" }, 100);
      result.current.save({ title: "second" }, 100);
    });
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(localStorage.getItem("draft-key")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(JSON.parse(localStorage.getItem("draft-key")!)).toEqual({
      data: { title: "second" },
      savedAt: Date.now(),
    });
    expect(result.current.load()).toEqual({ title: "second" });

    act(() => {
      result.current.clear();
    });
    expect(result.current.load()).toBeNull();
  });

  it("discards and removes an expired draft", () => {
    const expired = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem("draft-key", JSON.stringify({ data: "old", savedAt: expired }));

    const { result } = renderHook(() => useDraftPersist<string>("draft-key"));

    expect(result.current.load()).toBeNull();
    expect(localStorage.getItem("draft-key")).toBeNull();
  });

  it("returns null for malformed stored data", () => {
    localStorage.setItem("draft-key", "{broken");

    const { result } = renderHook(() => useDraftPersist<string>("draft-key"));

    expect(result.current.load()).toBeNull();
    expect(localStorage.getItem("draft-key")).toBe("{broken");
  });

  it("ignores storage write failures", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    const { result } = renderHook(() => useDraftPersist<string>("draft-key"));

    act(() => {
      result.current.save("value", 50);
    });
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(50);
      });
    }).not.toThrow();

    setItem.mockRestore();
  });
});
