import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { KPICard } from "../KPICard";

beforeAll(() => {
  // Recharts' ResponsiveContainer observes its parent's size; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("KPICard", () => {
  it("announces the loading state and hides the placeholder value", () => {
    render(<KPICard title="Active Deals" value="42" isLoading />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading Active Deals");
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });

  it("renders the title, value and a positive change", () => {
    render(<KPICard title="Active Deals" value="42" change={12.4} changeLabel="vs last month" />);

    expect(screen.getByRole("heading", { name: "42" })).toBeInTheDocument();
    expect(screen.getByText("Active Deals")).toBeInTheDocument();
    expect(screen.getByText("+12.4%")).toBeInTheDocument();
    expect(screen.getByText("vs last month")).toBeInTheDocument();
  });

  it("renders a negative change without a plus sign", () => {
    render(<KPICard title="Defaults" value="3" change={-3.2} />);

    expect(screen.getByText("-3.2%")).toBeInTheDocument();
    expect(screen.getByText("vs last period")).toBeInTheDocument();
  });

  it("renders a zero value and a zero change as neutral", () => {
    render(<KPICard title="Disputes" value={0} change={0} />);

    expect(screen.getByRole("heading", { name: "0" })).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryByText("+0%")).not.toBeInTheDocument();
  });

  it("falls back to a live-updates hint when no change is given", () => {
    render(<KPICard title="Users" value="10" />);

    expect(screen.getByText("Live updates active")).toBeInTheDocument();
  });

  it("renders large pre-formatted monetary values verbatim", () => {
    render(<KPICard title="Total Volume" value="₦1,234,567,890" change={250.75} />);

    expect(screen.getByRole("heading", { name: "₦1,234,567,890" })).toBeInTheDocument();
    expect(screen.getByText("+250.75%")).toBeInTheDocument();
  });

  it("gives the sparkline a text alternative listing its values", () => {
    render(<KPICard title="Revenue" value="₦5M" sparklineData={[1, 2, 3]} />);

    expect(screen.getByRole("img", { name: "Revenue trend: 1, 2, 3" })).toBeInTheDocument();
  });

  it("describes an empty sparkline as having no data", () => {
    render(<KPICard title="Revenue" value="₦0" sparklineData={[]} />);

    expect(screen.getByRole("img", { name: "Revenue trend: no data" })).toBeInTheDocument();
  });
});
