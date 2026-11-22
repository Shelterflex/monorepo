import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMounted } from "../use-mounted";

describe("useMounted", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true on the client after subscribing", () => {
    const { result, unmount } = renderHook(() => useMounted());

    expect(result.current).toBe(true);

    unmount();
  });

  it("renders false on the server", () => {
    function Probe() {
      return createElement("span", null, String(useMounted()));
    }

    expect(renderToString(createElement(Probe))).toContain("false");
  });

  it("stays true for hooks mounted after the first subscription", () => {
    const first = renderHook(() => useMounted());
    const second = renderHook(() => useMounted());

    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);

    first.unmount();
    second.unmount();
  });
});
