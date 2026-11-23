import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCountdown } from "../useCountdown";

describe("useCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 and expired when no target is provided", () => {
    const { result } = renderHook(() => useCountdown());
    expect(result.current.timeLeft).toBe(0);
    expect(result.current.isExpired).toBe(true);
    expect(result.current.formatTime()).toBe("00:00:00");
  });

  it("counts down to zero from a future target", () => {
    const now = Date.now();
    const target = new Date(now + 5000); // 5 seconds from now

    const { result } = renderHook(() => useCountdown(target.toISOString()));

    // Initial tick sets the value via setTimeout(0)
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.timeLeft).toBe(5);
    expect(result.current.isExpired).toBe(false);
    expect(result.current.formatTime()).toBe("00:00:05");

    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.timeLeft).toBe(2);

    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.timeLeft).toBe(0);
    expect(result.current.isExpired).toBe(true);
    expect(result.current.formatTime()).toBe("00:00:00");
  });

  it("clamps to zero for past targets", () => {
    const past = new Date(Date.now() - 10000);
    const { result } = renderHook(() => useCountdown(past.toISOString()));

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.timeLeft).toBe(0);
    expect(result.current.isExpired).toBe(true);
  });

  it("formats days when countdown exceeds 24 hours", () => {
    const now = Date.now();
    const target = new Date(now + 86400 * 1000 + 3661 * 1000); // 1d 1h 1m 1s

    const { result } = renderHook(() => useCountdown(target.toISOString()));
    act(() => { vi.advanceTimersByTime(1); });

    expect(result.current.formatTime()).toBe("1d 01h 01m 01s");
  });

  it("restarts countdown when target changes", () => {
    const now = Date.now();
    const target1 = new Date(now + 3000);
    const target2 = new Date(now + 10000);

    const { result, rerender } = renderHook(
      ({ target }) => useCountdown(target),
      { initialProps: { target: target1.toISOString() } },
    );

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.timeLeft).toBe(3);

    // Rerender with a new future target; advancing should reflect the new target
    rerender({ target: target2.toISOString() });
    act(() => { vi.advanceTimersByTime(1); });
    // The timer should now be counting from target2
    expect(result.current.timeLeft).toBeGreaterThan(5);
  });

  it("cleans up interval on unmount", () => {
    const now = Date.now();
    const target = new Date(now + 60000);

    const { unmount } = renderHook(() => useCountdown(target.toISOString()));

    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("formats zero as 00:00:00", () => {
    const now = Date.now();
    const target = new Date(now);
    const { result } = renderHook(() => useCountdown(target.toISOString()));

    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.formatTime()).toBe("00:00:00");
  });

  it("formats seconds and minutes correctly", () => {
    const now = Date.now();
    const target = new Date(now + 125 * 1000); // 2m 5s

    const { result } = renderHook(() => useCountdown(target.toISOString()));
    act(() => { vi.advanceTimersByTime(1); });

    expect(result.current.formatTime()).toBe("00:02:05");
  });

  it("clears the initial timeout on unmount", () => {
    const target = new Date(Date.now() + 5000);
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const { unmount } = renderHook(() => useCountdown(target.toISOString()));
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("leaves the countdown invalid for an unparseable target", () => {
    const { result } = renderHook(() => useCountdown("not-a-date"));

    act(() => { vi.advanceTimersByTime(1); });

    expect(Number.isNaN(result.current.timeLeft)).toBe(true);
    expect(result.current.isExpired).toBe(false);
  });
});
