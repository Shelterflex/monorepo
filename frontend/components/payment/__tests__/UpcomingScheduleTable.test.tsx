import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { UpcomingScheduleTable, type ScheduleRow } from "../UpcomingScheduleTable";

const schedule: ScheduleRow[] = [
  { period: 1, month: "January 2026", amount: 50_000, dueDate: "2026-01-15", status: "paid" },
  { period: 2, month: "February 2026", amount: 50_000, dueDate: "2026-02-15", status: "overdue" },
  { period: 3, month: "March 2026", amount: 1_250_000.5, dueDate: "2026-03-15", status: "upcoming", isNextDue: true },
  { period: 4, month: "April 2026", amount: 0, dueDate: "2026-04-15", status: "pending" },
];

function renderTable(props: Partial<React.ComponentProps<typeof UpcomingScheduleTable>> = {}) {
  return render(
    <NextIntlClientProvider locale="en-NG" messages={{}}>
      <UpcomingScheduleTable schedule={schedule} onPayNow={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

function rowFor(month: string) {
  return screen.getByRole("cell", { name: new RegExp(month) }).closest("tr")!;
}

describe("UpcomingScheduleTable", () => {
  it("renders only the header row for an empty schedule", () => {
    renderTable({ schedule: [] });

    const table = screen.getByRole("table", { name: "Payment schedule" });
    expect(within(table).getAllByRole("row")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /pay installment/i })).not.toBeInTheDocument();
  });

  it("labels paid, overdue, upcoming and processing rows", () => {
    renderTable();

    expect(within(rowFor("January 2026")).getByLabelText("Status: Paid")).toBeInTheDocument();
    expect(within(rowFor("February 2026")).getByLabelText("Status: Overdue")).toBeInTheDocument();
    expect(within(rowFor("March 2026")).getByLabelText("Status: Upcoming")).toBeInTheDocument();
    expect(within(rowFor("April 2026")).getByLabelText("Status: Processing")).toBeInTheDocument();
  });

  it("formats amounts as NGN for the active locale", () => {
    renderTable();

    expect(within(rowFor("January 2026")).getByText("₦50,000.00")).toBeInTheDocument();
    expect(within(rowFor("March 2026")).getByText("₦1,250,000.50")).toBeInTheDocument();
    expect(within(rowFor("April 2026")).getByText("₦0.00")).toBeInTheDocument();
  });

  it("only offers Pay Now on the next-due row, named with installment and amount", async () => {
    const user = userEvent.setup();
    const onPayNow = vi.fn();
    renderTable({ onPayNow });

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    const pay = screen.getByRole("button", { name: "Pay installment 3 - ₦1,250,000.50" });
    expect(within(rowFor("March 2026")).getByRole("button")).toBe(pay);

    await user.click(pay);
    expect(onPayNow).toHaveBeenCalledTimes(1);
  });

  it("shows an optimistic processing state and hides Pay Now", () => {
    renderTable({ optimisticStatuses: { 3: "pending" } });

    expect(within(rowFor("March 2026")).getByLabelText("Status: Processing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pay installment 3/i })).not.toBeInTheDocument();
  });

  it("shows an optimistic failure state", () => {
    renderTable({ optimisticStatuses: { 3: "failed" } });

    expect(within(rowFor("March 2026")).getByLabelText("Status: Failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pay installment 3/i })).not.toBeInTheDocument();
  });
});
