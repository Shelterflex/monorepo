import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock @/lib/config before importing the component
const mockGetHealth = vi.fn();
vi.mock("@/lib/config", () => ({
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
}));

// Mock @/components/ui/spinner to avoid import issues
vi.mock("@/components/ui/spinner", () => ({
  Spinner: ({ className }: { className?: string }) => (
    <div data-testid="spinner" className={className} role="status" aria-label="Loading" />
  ),
}));

import BackendHealth from "./BackendHealth";

describe("BackendHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure env var is set so the component attempts to fetch
    process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:3001";
  });

  it("shows loading state initially", () => {
    // Never resolves so we stay in loading
    mockGetHealth.mockReturnValue(new Promise(() => {}));

    render(<BackendHealth />);

    expect(screen.getByText("Checking connection...")).toBeInTheDocument();
  });

  it("shows success state with health data after getHealth resolves", async () => {
    mockGetHealth.mockResolvedValue({
      status: "ok",
      version: "1.2.3",
      uptimeSeconds: 3600,
    });

    render(<BackendHealth />);

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });

    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("1.2.3")).toBeInTheDocument();
    expect(screen.getByText("3600s")).toBeInTheDocument();
  });

  it("shows error state when getHealth rejects", async () => {
    mockGetHealth.mockRejectedValue(new Error("Network failure"));

    render(<BackendHealth />);

    await waitFor(() => {
      expect(screen.getByText("Connection Failed")).toBeInTheDocument();
    });

    expect(screen.getByText("Network failure")).toBeInTheDocument();
  });
});
