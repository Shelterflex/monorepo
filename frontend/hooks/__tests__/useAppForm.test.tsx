import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { z } from "zod";
import { useAppForm } from "../useAppForm";

const schema = z.object({
  title: z.string().min(3),
  count: z.number(),
});

function options(draftKey?: string) {
  return {
    schema,
    defaultValues: { title: "", count: 0 },
    ...(draftKey ? { draftKey, draftDebounceMs: 100 } : {}),
  };
}

describe("useAppForm", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("submits valid values", async () => {
    const onValid = vi.fn();
    const { result } = renderHook(() => useAppForm(options()));

    await act(async () => {
      result.current.setValue("title", "Valid title");
    });
    await act(async () => {
      await result.current.handleSubmit(onValid)();
    });

    expect(onValid).toHaveBeenCalledTimes(1);
    expect(onValid.mock.calls[0][0]).toEqual(
      expect.objectContaining({ title: "Valid title", count: 0 }),
    );
  });

  it("saves a debounced draft and restores it on the next mount", () => {
    const first = renderHook(() => useAppForm(options("app-form-draft")));

    act(() => {
      first.result.current.setValue("title", "Saved title");
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(JSON.parse(localStorage.getItem("form-draft:app-form-draft")!)).toEqual(
      expect.objectContaining({ title: "Saved title" }),
    );
    first.unmount();

    const second = renderHook(() => useAppForm(options("app-form-draft")));
    expect(second.result.current.getValues("title")).toBe("Saved title");

    act(() => {
      second.result.current.clearDraft();
    });
    expect(localStorage.getItem("form-draft:app-form-draft")).toBeNull();
    second.unmount();
  });

  it("reports validation errors for invalid values", async () => {
    const onValid = vi.fn();
    const onInvalid = vi.fn();
    const { result } = renderHook(() => useAppForm(options()));

    await act(async () => {
      await result.current.handleSubmit(onValid, onInvalid)();
    });

    expect(onValid).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(onInvalid.mock.calls[0][0].title).toBeDefined();
  });

  it("falls back to defaults when the stored draft is corrupt", () => {
    localStorage.setItem("form-draft:bad-draft", "{broken");

    const { result } = renderHook(() => useAppForm(options("bad-draft")));

    expect(result.current.getValues()).toEqual({ title: "", count: 0 });
  });

  it("ignores draft write failures", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    const { result } = renderHook(() => useAppForm(options("failing-draft")));

    act(() => {
      result.current.setValue("title", "No storage");
    });
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }).not.toThrow();

    setItem.mockRestore();
  });
});
