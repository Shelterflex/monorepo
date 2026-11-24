import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DisputeStatusTimeline } from "../DisputeStatusTimeline";
import type { PaymentDispute } from "@/lib/tenantApi";

function dispute(overrides: Partial<PaymentDispute> = {}): PaymentDispute {
  return {
    id: "disp-1",
    paymentId: "p1",
    dealId: "d1",
    reason: "duplicate_charge",
    description: "I was charged twice for January",
    status: "pending",
    resolution: null,
    createdAt: "2026-01-10T09:00:00Z",
    updatedAt: "2026-01-10T09:00:00Z",
    ...overrides,
  };
}

function steps() {
  return within(screen.getByRole("list", { name: "Dispute status timeline" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);
}

describe("DisputeStatusTimeline", () => {
  it("shows the reason, filing date and an under-review badge for a pending dispute", () => {
    render(<DisputeStatusTimeline dispute={dispute()} />);

    expect(screen.getByText("Duplicate charge")).toBeInTheDocument();
    expect(screen.getByText(/^Filed /)).toHaveTextContent(/2026/);
    expect(screen.getByText("Under Review", { selector: "span" })).toBeInTheDocument();
    expect(steps()).toEqual(["Filed", "Under Review", "Resolved"]);
    expect(screen.queryByText("Resolution")).not.toBeInTheDocument();
  });

  it("labels an under_review dispute as Under Review", () => {
    render(<DisputeStatusTimeline dispute={dispute({ status: "under_review" })} />);

    expect(screen.getByText("Under Review", { selector: "span" })).toBeInTheDocument();
  });

  it("ends the timeline with Rejected for a rejected dispute and shows the resolution", () => {
    render(
      <DisputeStatusTimeline
        dispute={dispute({ status: "rejected", resolution: "Charge was valid", reason: "other" })}
      />,
    );

    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getByText("Rejected", { selector: "span" })).toBeInTheDocument();
    expect(steps()).toEqual(["Filed", "Under Review", "Rejected"]);
    expect(screen.getByText("Resolution")).toBeInTheDocument();
    expect(screen.getByText("Charge was valid")).toBeInTheDocument();
  });

  it("ends the timeline with Resolved for a resolved dispute", () => {
    render(<DisputeStatusTimeline dispute={dispute({ status: "resolved", resolution: "Refund issued" })} />);

    expect(screen.getByText("Resolved", { selector: "span" })).toBeInTheDocument();
    expect(steps()).toEqual(["Filed", "Under Review", "Resolved"]);
    expect(screen.getByText("Refund issued")).toBeInTheDocument();
  });
});
