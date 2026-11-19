// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardRootPage from "./page";

const { authState, mockReplace } = vi.hoisted(() => ({
  authState: { role: "landlord" as string | null, hasHydrated: true },
  mockReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("@/store/useAuthStore", () => ({
  default: Object.assign(
    (selector: (state: { user: { role: string } | null }) => unknown) =>
      selector({ user: authState.role ? { role: authState.role } : null }),
    {
      persist: {
        hasHydrated: () => authState.hasHydrated,
        onFinishHydration: vi.fn(() => vi.fn()),
      },
    },
  ),
}));

describe("DashboardRootPage", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    authState.role = "landlord";
    authState.hasHydrated = true;
  });

  it.each([
    ["landlord", "/dashboard/landlord"],
    ["admin", "/admin"],
  ])("redirects the %s role to its dashboard", async (role, path) => {
    authState.role = role;

    render(<DashboardRootPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(path));
  });
});