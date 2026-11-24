import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RevenueChart, type RevenueTimelineData } from "../RevenueChart";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const ngn = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n);

describe("RevenueChart", () => {
  it("announces the loading state and hides the range controls", () => {
    render(<RevenueChart isLoading />);

    expect(screen.getByRole("status", { name: "Loading platform revenue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "7d" })).not.toBeInTheDocument();
  });

  it("shows the empty state for missing or empty series", () => {
    const { rerender } = render(<RevenueChart />);
    expect(screen.getByText("No revenue recorded in this timeframe")).toBeInTheDocument();

    rerender(<RevenueChart data={{ series: [], dataSource: "live" }} />);
    expect(screen.getByText("No revenue recorded in this timeframe")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("summarises the series in the chart's text alternative, pivoting fee types by day", () => {
    const data: RevenueTimelineData = {
      dataSource: "live",
      series: [
        { date: "2026-05-02", feeType: "platform_fee", amount: 1_500_000 },
        { date: "2026-05-01", feeType: "platform_fee", amount: 250_000 },
        { date: "2026-05-01", feeType: "underwriting_fee", amount: 99_999_999 },
        // Unknown fee types fall back to the platform bucket.
        { date: "2026-05-02", feeType: "mystery_fee", amount: 1 },
      ],
    };
    render(<RevenueChart data={data} />);

    expect(
      screen.getByRole("img", {
        name: `Platform revenue across 2 days: ${ngn(1_750_001)} platform fees, ${ngn(99_999_999)} underwriting fees`,
      }),
    ).toBeInTheDocument();
  });

  it("uses the singular for one day and reports zero underwriting fees", () => {
    render(
      <RevenueChart
        data={{ dataSource: "mock", series: [{ date: "2026-05-01", feeType: "platform_fee", amount: 0 }] }}
      />,
    );

    expect(
      screen.getByRole("img", {
        name: `Platform revenue across 1 day: ${ngn(0)} platform fees, ${ngn(0)} underwriting fees`,
      }),
    ).toBeInTheDocument();
  });

  it("defaults to 30d and reports range changes", async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn();
    render(<RevenueChart onRangeChange={onRangeChange} />);

    const group = screen.getByRole("group", { name: "Revenue timeframe" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "7d" }));
    expect(onRangeChange).toHaveBeenCalledWith("7d");
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "90d" }));
    expect(onRangeChange).toHaveBeenLastCalledWith("90d");
  });

  it("still switches range when no callback is provided", async () => {
    const user = userEvent.setup();
    render(<RevenueChart />);

    await user.click(screen.getByRole("button", { name: "90d" }));
    expect(screen.getByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");
  });
});
