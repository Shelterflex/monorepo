import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PaymentTimelineNode } from "../PaymentTimelineNode";

const base = {
  date: "Jan 15, 2026",
  amount: 150_000,
  reference: "REF-001",
};

describe("PaymentTimelineNode", () => {
  it("renders a paid payment with NGN currency formatting", () => {
    render(<PaymentTimelineNode {...base} status="Paid" />);

    expect(screen.getByText("₦150,000.00")).toBeInTheDocument();
    expect(screen.getByText("Status:", { exact: false }).parentElement).toHaveTextContent("Status: Paid");
    expect(screen.getByText("Reference: REF-001")).toBeInTheDocument();
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });

  it("renders an overdue payment with plural day count", () => {
    render(<PaymentTimelineNode {...base} status="Overdue" isOverdue daysOverdue={5} />);

    expect(screen.getByText("Status:", { exact: false }).parentElement).toHaveTextContent("Status: Overdue");
    expect(screen.getByText("5 days overdue")).toBeInTheDocument();
  });

  it("uses the singular for one day overdue", () => {
    render(<PaymentTimelineNode {...base} status="Overdue" isOverdue daysOverdue={1} />);

    expect(screen.getByText("1 day overdue")).toBeInTheDocument();
  });

  it("does not show the overdue pill when the day count is missing or zero", () => {
    render(<PaymentTimelineNode {...base} status="Overdue" isOverdue daysOverdue={0} />);

    expect(screen.queryByText(/days? overdue/)).not.toBeInTheDocument();
  });

  it("renders upcoming and processing states", () => {
    const { rerender } = render(<PaymentTimelineNode {...base} status="Upcoming" />);
    expect(screen.getByText("Status:", { exact: false }).parentElement).toHaveTextContent("Status: Upcoming");

    rerender(<PaymentTimelineNode {...base} status="Processing" />);
    expect(screen.getByText("Status:", { exact: false }).parentElement).toHaveTextContent("Status: Processing");
  });

  it("formats zero and large amounts", () => {
    const { rerender } = render(<PaymentTimelineNode {...base} amount={0} status="Upcoming" />);
    expect(screen.getByText("₦0.00")).toBeInTheDocument();

    rerender(<PaymentTimelineNode {...base} amount={1_234_567_890.5} status="Upcoming" />);
    expect(screen.getByText("₦1,234,567,890.50")).toBeInTheDocument();
  });

  it("shows the on-chain badge only when confirmed", () => {
    const { rerender } = render(<PaymentTimelineNode {...base} status="Paid" />);
    expect(screen.queryByText("Confirmed on-chain")).not.toBeInTheDocument();

    rerender(<PaymentTimelineNode {...base} status="Paid" confirmedOnChain />);
    expect(screen.getByText("Confirmed on-chain")).toBeInTheDocument();
  });

  it("downloads a receipt", async () => {
    const user = userEvent.setup();
    const onDownloadReceipt = vi.fn();
    render(<PaymentTimelineNode {...base} status="Paid" onDownloadReceipt={onDownloadReceipt} />);

    await user.click(screen.getByRole("button", { name: "Download Receipt" }));
    expect(onDownloadReceipt).toHaveBeenCalledTimes(1);
  });

  it("offers Report a problem when there is no dispute", async () => {
    const user = userEvent.setup();
    const onReportProblem = vi.fn();
    render(<PaymentTimelineNode {...base} status="Paid" onReportProblem={onReportProblem} />);

    expect(screen.queryByRole("button", { name: "View Dispute" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Report a problem" }));
    expect(onReportProblem).toHaveBeenCalledTimes(1);
  });

  it("offers View Dispute instead of reporting when a dispute exists", async () => {
    const user = userEvent.setup();
    const onViewDispute = vi.fn();
    const onReportProblem = vi.fn();
    render(
      <PaymentTimelineNode
        {...base}
        status="Paid"
        disputeStatus="under_review"
        onViewDispute={onViewDispute}
        onReportProblem={onReportProblem}
      />,
    );

    expect(screen.queryByRole("button", { name: "Report a problem" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View Dispute" }));
    expect(onViewDispute).toHaveBeenCalledTimes(1);
    expect(onReportProblem).not.toHaveBeenCalled();
  });

  it("shows neither dispute action when no handler is provided", () => {
    render(<PaymentTimelineNode {...base} status="Paid" />);

    expect(screen.queryByRole("button", { name: "Report a problem" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View Dispute" })).not.toBeInTheDocument();
  });
});
