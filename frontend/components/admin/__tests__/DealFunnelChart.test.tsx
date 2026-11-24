import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { DealFunnelChart } from "../DealFunnelChart";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const zero = { draft: 0, active: 0, at_risk: 0, completed: 0, defaulted: 0 };

describe("DealFunnelChart", () => {
  it("announces the loading state", () => {
    render(<DealFunnelChart isLoading />);

    expect(screen.getByRole("status", { name: "Loading deal funnel" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /deal funnel status/i })).not.toBeInTheDocument();
  });

  it("shows the empty state when no data is passed", () => {
    render(<DealFunnelChart />);

    expect(screen.getByRole("heading", { name: /deal funnel status/i })).toBeInTheDocument();
    expect(screen.getByText("No deal data available")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the empty state when every stage is zero", () => {
    render(<DealFunnelChart data={zero} />);

    expect(screen.getByText("No deal data available")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("gives the populated chart a text alternative with every stage and the total", () => {
    render(
      <DealFunnelChart data={{ draft: 4, active: 10, at_risk: 2, completed: 7, defaulted: 1 }} />,
    );

    expect(
      screen.getByRole("img", {
        name: "Deal funnel: Draft 4, Active 10, At Risk 2, Completed 7, Defaulted 1 (24 total)",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No deal data available")).not.toBeInTheDocument();
  });

  it("handles a single non-zero stage and large counts", () => {
    render(<DealFunnelChart data={{ ...zero, completed: 1_250_000 }} />);

    expect(
      screen.getByRole("img", {
        name: "Deal funnel: Draft 0, Active 0, At Risk 0, Completed 1250000, Defaulted 0 (1250000 total)",
      }),
    ).toBeInTheDocument();
  });
});
