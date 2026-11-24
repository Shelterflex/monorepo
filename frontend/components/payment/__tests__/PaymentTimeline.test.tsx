import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PaymentTimeline } from "../PaymentTimeline";
import type { PaymentHistoryItem } from "@/lib/tenantApi";

// PaymentTimelineNode keys its badge config on capitalised labels
// ("Paid" | "Overdue" | ...), so the fixtures use those. See the todo below.
function payment(
  overrides: Partial<Omit<PaymentHistoryItem, "status">> & { status: string },
): PaymentHistoryItem {
  return {
    id: "p1",
    dealId: "d1",
    reference: "REF-1",
    amount: 100_000,
    transactionDate: "Jan 1, 2026",
    method: "card",
    ...overrides,
  } as PaymentHistoryItem;
}

const defaultProps = {
  onDownloadReceipt: vi.fn(),
  onLoadMore: vi.fn(),
  hasMore: false,
  isLoading: false,
};

describe("PaymentTimeline", () => {
  it("renders the empty state with no list and an empty live region", () => {
    render(<PaymentTimeline {...defaultProps} payments={[]} />);

    expect(screen.getByText("No payment records yet")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Payment history timeline" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("renders one list item per payment and announces the latest status", () => {
    render(
      <PaymentTimeline
        {...defaultProps}
        payments={[
          payment({ id: "p1", reference: "REF-1", status: "Overdue", isOverdue: true, daysOverdue: 3 }),
          payment({ id: "p2", reference: "REF-2", status: "Paid" }),
          payment({ id: "p3", reference: "REF-3", status: "Upcoming" }),
        ]}
      />,
    );

    const list = screen.getByRole("list", { name: "Payment history timeline" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("3 days overdue")).toBeInTheDocument();
    expect(within(items[1]).getByText("Reference: REF-2")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing 3 payments. Most recent payment is Overdue.",
    );
    expect(screen.queryByText("No payment records yet")).not.toBeInTheDocument();
  });

  it("uses the singular when announcing a single payment", () => {
    render(<PaymentTimeline {...defaultProps} payments={[payment({ status: "Paid" })]} />);

    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 payment. Most recent payment is Paid.");
  });

  it("downloads the receipt for the clicked payment's reference", async () => {
    const user = userEvent.setup();
    const onDownloadReceipt = vi.fn();
    render(
      <PaymentTimeline
        {...defaultProps}
        onDownloadReceipt={onDownloadReceipt}
        payments={[payment({ id: "a", reference: "REF-A", status: "Paid" }), payment({ id: "b", reference: "REF-B", status: "Paid" })]}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "Download Receipt" })[1]);
    expect(onDownloadReceipt).toHaveBeenCalledWith("REF-B");
  });

  it("routes dispute actions by payment id using the status map", async () => {
    const user = userEvent.setup();
    const onReportProblem = vi.fn();
    const onViewDispute = vi.fn();
    render(
      <PaymentTimeline
        {...defaultProps}
        payments={[payment({ id: "a", status: "Paid" }), payment({ id: "b", status: "Paid" })]}
        disputeStatusByPayment={{ a: "pending", b: null }}
        onReportProblem={onReportProblem}
        onViewDispute={onViewDispute}
      />,
    );

    await user.click(screen.getByRole("button", { name: "View Dispute" }));
    expect(onViewDispute).toHaveBeenCalledWith("a");
    await user.click(screen.getByRole("button", { name: "Report a problem" }));
    expect(onReportProblem).toHaveBeenCalledWith("b");
  });

  it("loads more when there are more pages, and disables the button while loading", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <PaymentTimeline {...defaultProps} hasMore onLoadMore={onLoadMore} payments={[payment({ status: "Paid" })]} />,
    );

    await user.click(screen.getByRole("button", { name: "Load More" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      <PaymentTimeline {...defaultProps} hasMore isLoading onLoadMore={onLoadMore} payments={[payment({ status: "Paid" })]} />,
    );
    expect(screen.getByRole("button", { name: "Loading..." })).toBeDisabled();
  });

  it("hides Load More on the last page", () => {
    render(<PaymentTimeline {...defaultProps} payments={[payment({ status: "Paid" })]} />);

    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  // PaymentHistoryItem.status is typed (and sent by the backend) as lowercase
  // "paid" | "overdue" | "upcoming" | "processing", but PaymentTimelineNode only
  // has config for "Paid" | "Overdue" | ..., so a real history item throws on
  // render. Reported in the PR rather than fixed here (tests-only scope).
  it.todo("renders backend-cased statuses such as 'paid' and 'overdue'");
});
