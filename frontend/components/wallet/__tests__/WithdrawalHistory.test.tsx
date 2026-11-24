import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WithdrawalHistory } from "../WithdrawalHistory";
import { getWithdrawalHistory, type WithdrawalResponse } from "@/lib/walletApi";

vi.mock("@/lib/walletApi", () => ({ getWithdrawalHistory: vi.fn() }));

function withdrawal(overrides: Partial<WithdrawalResponse> = {}): WithdrawalResponse {
  return {
    id: "w1",
    amountNgn: 25_000,
    status: "pending",
    bankAccount: { bankName: "Access Bank", accountNumber: "0123456789", accountName: "Ada Obi" } as never,
    reference: "WD-REF-1",
    createdAt: "2026-11-20T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getWithdrawalHistory).mockReset();
});

describe("WithdrawalHistory", () => {
  it("announces loading and requests the latest ten withdrawals", () => {
    vi.mocked(getWithdrawalHistory).mockReturnValue(new Promise(() => {}));
    render(<WithdrawalHistory />);

    expect(screen.getByRole("heading", { name: "Withdrawal History" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading withdrawal history" })).toBeInTheDocument();
    expect(getWithdrawalHistory).toHaveBeenCalledWith({ limit: 10 });
  });

  it("shows the empty state", async () => {
    vi.mocked(getWithdrawalHistory).mockResolvedValue({ entries: [] });
    render(<WithdrawalHistory />);

    expect(await screen.findByText("No withdrawals yet")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the error message and retries from the error state", async () => {
    const user = userEvent.setup();
    vi.mocked(getWithdrawalHistory)
      .mockRejectedValueOnce(new Error("Service unavailable"))
      .mockResolvedValue({ entries: [withdrawal()] });
    render(<WithdrawalHistory />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load withdrawal history");
    expect(alert).toHaveTextContent("Service unavailable");

    // One Retry in the header, one in the error panel.
    const retries = screen.getAllByRole("button", { name: "Retry" });
    expect(retries).toHaveLength(2);
    await user.click(retries[1]);

    expect(await screen.findByText("WD-REF-1")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses a generic message for non-Error failures", async () => {
    vi.mocked(getWithdrawalHistory).mockRejectedValue("boom");
    render(<WithdrawalHistory />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("refetches from the header Retry button", async () => {
    const user = userEvent.setup();
    vi.mocked(getWithdrawalHistory).mockResolvedValue({ entries: [] });
    render(<WithdrawalHistory />);

    await screen.findByText("No withdrawals yet");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(getWithdrawalHistory).toHaveBeenCalledTimes(2));
  });

  it("renders each withdrawal with amount, bank details and status", async () => {
    vi.mocked(getWithdrawalHistory).mockResolvedValue({
      entries: [
        withdrawal({
          id: "a",
          reference: "WD-A",
          amountNgn: 1_234_567,
          status: "confirmed",
          bankAccount: { bankName: "Zenith Bank", accountNumber: "1112223334", accountName: "Ada Obi" } as never,
        }),
        withdrawal({ id: "b", reference: "WD-B", status: "approved" }),
        withdrawal({ id: "c", reference: "WD-C", status: "pending", amountNgn: 0 }),
      ],
    });
    render(<WithdrawalHistory />);

    expect(await screen.findByText("WD-A")).toBeInTheDocument();
    expect(screen.getByText("-₦1,234,567")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Zenith Bank")).toBeInTheDocument();
    expect(screen.getByText("1112223334")).toBeInTheDocument();
    expect(screen.getAllByText("Access Bank")).toHaveLength(2);

    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("-₦0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Contact support" })).not.toBeInTheDocument();
  });

  it("offers support for failed and rejected withdrawals", async () => {
    const user = userEvent.setup();
    vi.mocked(getWithdrawalHistory).mockResolvedValue({
      entries: [
        withdrawal({ id: "f", reference: "WD-FAIL", status: "failed" }),
        withdrawal({ id: "r", reference: "WD-REJ", status: "rejected" }),
      ],
    });
    render(<WithdrawalHistory />);

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    const support = screen.getAllByRole("button", { name: "Contact support" });
    expect(support).toHaveLength(2);

    const location = { href: "" };
    vi.stubGlobal("location", location);
    await user.click(support[0]);
    expect(location.href).toBe("mailto:support@example.com?subject=Withdrawal Issue - WD-FAIL");
    vi.unstubAllGlobals();
  });
});
