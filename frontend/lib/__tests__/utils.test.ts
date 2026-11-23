import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, debounce } from "../utils";

afterEach(() => {
  vi.useRealTimers();
});

describe("cn", () => {
  it("joins class names and drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("lets later Tailwind utilities win over earlier conflicting ones", () => {
    expect(cn("p-2 text-red-500", "p-4")).toBe("text-red-500 p-4");
  });
});

describe("debounce", () => {
  it("runs the function once, after the wait, with the latest arguments", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 300);

    debounced("first");
    vi.advanceTimersByTime(200);
    debounced("second");
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("second");
  });
});
