import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JobHealthPanel from "../JobHealthPanel";

vi.mock("@/lib/auth", () => ({ getToken: vi.fn(async () => "test-token") }));

// JobHealthPanel calls its Next.js route directly (there is no lib/*Api.ts
// wrapper for /api/admin/jobs/health), so fetch is the only network boundary.
const fetchMock = vi.fn();

function respond(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body } as Response;
}

const healthyJob = {
  name: "rent-reminders",
  module: "notifications",
  does: "Sends rent due reminders",
  expectedIntervalMs: 3_600_000,
  ifItDoesNotRun: "Tenants miss reminders",
  healthy: "ran within the last hour",
  state: "healthy" as const,
  overdue: false,
  secondsSinceLastRun: 125,
  lastRun: {
    startedAt: "2026-11-24T10:00:00Z",
    finishedAt: "2026-11-24T10:00:01Z",
    durationMs: 812,
    outcome: "completed" as const,
    recordsProcessed: 1_234_567,
    correlationId: "corr-abc",
  },
  lastSuccessAt: "2026-11-24T10:00:01Z",
  consecutiveFailures: 0,
};

const failingJob = {
  ...healthyJob,
  name: "ledger-sync",
  does: "Syncs ledger to chain",
  expectedIntervalMs: 86_400_000,
  ifItDoesNotRun: "Balances drift",
  state: "failing" as const,
  secondsSinceLastRun: 90_000,
  lastRun: { ...healthyJob.lastRun, outcome: "failed" as const, correlationId: null, error: "RPC timeout" },
  consecutiveFailures: 3,
};

const neverRanJob = {
  ...healthyJob,
  name: "payout-sweeper",
  does: "Sweeps payouts",
  expectedIntervalMs: 30_000,
  ifItDoesNotRun: "Landlords are not paid",
  state: "never_ran" as const,
  overdue: true,
  secondsSinceLastRun: null,
  lastRun: null,
  lastSuccessAt: null,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("JobHealthPanel", () => {
  it("announces loading until the report arrives, and sends the auth token", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    render(<JobHealthPanel />);

    expect(screen.getByRole("status", { name: "Loading background jobs" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/jobs/health", {
      headers: { Authorization: "Bearer test-token" },
    });

    await act(async () => {
      resolve(respond({ capturedAt: "", overdueCount: 0, failingCount: 0, jobs: [] }));
    });
    expect(screen.queryByRole("status", { name: "Loading background jobs" })).not.toBeInTheDocument();
  });

  it("renders an empty report without rows or an overdue badge", async () => {
    fetchMock.mockResolvedValue(respond({ capturedAt: "", overdueCount: 0, failingCount: 0, jobs: [] }));
    render(<JobHealthPanel />);

    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "Loading background jobs" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Background jobs")).toBeInTheDocument();
    expect(screen.queryByText(/overdue$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/last run/)).not.toBeInTheDocument();
  });

  it("shows an alert when the request fails", async () => {
    fetchMock.mockResolvedValue(respond({}, { ok: false, status: 503 }));
    render(<JobHealthPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Job health failed: 503");
  });

  it("shows a network error message from a rejected request", async () => {
    fetchMock.mockRejectedValue(new Error("Network down"));
    render(<JobHealthPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
  });

  it("renders healthy, failing and never-ran jobs with their details", async () => {
    fetchMock.mockResolvedValue(
      respond({ capturedAt: "", overdueCount: 1, failingCount: 1, jobs: [healthyJob, failingJob, neverRanJob] }),
    );
    render(<JobHealthPanel />);

    expect(await screen.findByText("rent-reminders")).toBeInTheDocument();
    expect(screen.getByText("1 overdue")).toBeInTheDocument();

    // Healthy job: interval, elapsed time, run stats including a large record count.
    expect(screen.getByText("healthy")).toBeInTheDocument();
    expect(screen.getByText(/every 1h/)).toBeInTheDocument();
    expect(screen.getByText("2m ago")).toBeInTheDocument();
    expect(screen.getAllByText("1234567")).toHaveLength(2);
    expect(screen.getByText("correlation corr-abc")).toBeInTheDocument();

    // Failing job: error text, failure count and impact.
    expect(screen.getByText("failing")).toBeInTheDocument();
    expect(screen.getByText(/every 1d/)).toBeInTheDocument();
    expect(screen.getByText("1d ago")).toBeInTheDocument();
    expect(screen.getByText("RPC timeout")).toBeInTheDocument();
    expect(screen.getByText("3 consecutive failure(s)")).toBeInTheDocument();
    expect(screen.getByText("Impact if it stays down: Balances drift")).toBeInTheDocument();

    // Never-ran job.
    expect(screen.getByText("never ran")).toBeInTheDocument();
    expect(screen.getByText(/every 30s/)).toBeInTheDocument();
    expect(screen.getByText("never")).toBeInTheDocument();
    expect(screen.getByText("Impact if it stays down: Landlords are not paid")).toBeInTheDocument();

    // Healthy jobs do not show an impact line.
    expect(screen.queryByText("Impact if it stays down: Tenants miss reminders")).not.toBeInTheDocument();
  });

  it("formats sub-minute and multi-hour elapsed times and overdue state", async () => {
    fetchMock.mockResolvedValue(
      respond({
        capturedAt: "",
        overdueCount: 2,
        failingCount: 0,
        jobs: [
          { ...healthyJob, name: "a", secondsSinceLastRun: 45, expectedIntervalMs: 60_000 },
          { ...healthyJob, name: "b", state: "overdue", secondsSinceLastRun: 7_200 },
        ],
      }),
    );
    render(<JobHealthPanel />);

    expect(await screen.findByText("45s ago")).toBeInTheDocument();
    expect(screen.getByText(/every 1m/)).toBeInTheDocument();
    expect(screen.getByText("2h ago")).toBeInTheDocument();
    expect(screen.getByText("overdue")).toBeInTheDocument();
    expect(screen.getByText("2 overdue")).toBeInTheDocument();
  });

  it("omits the auth header when there is no token", async () => {
    const { getToken } = await import("@/lib/auth");
    vi.mocked(getToken).mockResolvedValueOnce(null as never);
    fetchMock.mockResolvedValue(respond({ capturedAt: "", overdueCount: 0, failingCount: 0, jobs: [] }));
    render(<JobHealthPanel />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/jobs/health", { headers: {} }));
  });

  it("refreshes every 15 seconds and recovers from an earlier error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock
      .mockResolvedValueOnce(respond({}, { ok: false, status: 500 }))
      .mockResolvedValue(respond({ capturedAt: "", overdueCount: 0, failingCount: 0, jobs: [healthyJob] }));
    render(<JobHealthPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent("500");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(await screen.findByText("rent-reminders")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
