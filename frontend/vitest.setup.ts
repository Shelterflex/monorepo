import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  cleanup();
  if (typeof localStorage?.clear === "function") {
    localStorage.clear();
  }
  vi.restoreAllMocks();
  vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();

  return {
    ...actual,
    usePathname: vi.fn(() => "/"),
    useSearchParams: vi.fn(() => new URLSearchParams()),
    useRouter: vi.fn(() => ({
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      push: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
    })),
  };
});
});
