import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryTable } from "../HistoryTable";
import { getStakingHistory, type StakingHistoryItem } from "@/lib/config";

vi.mock("@/lib/config", () => ({ getStakingHistory: vi.fn() }));

const TX = "ABCDEF1234567890ABCDEF1234567890XYZ123";

const items: StakingHistoryItem[] = [
  { txId: TX, txType: "STAKE", amountUsdc: "1234567.5", amountNgn: "1851851250", fxRate: "1500", indexedAt: "2026-11-01T10:00:00Z" },
  { txId: "UNSTAKE0000000000000001", txType: "UNSTAKE", amountUsdc: 25, indexedAt: "2026-11-02T10:00:00Z" },
  { txId: "CLAIM00000000000000000002", txType: "STAKE_REWARD_CLAIM", amountUsdc: "0", indexedAt: "2026-11-03T10:00:00Z" },
];

beforeEach(() => {
  vi.mocked(getStakingHistory).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("HistoryTable", () => {
  it("announces loading and disables refresh while fetching", async () => {
    vi.mocked(getStakingHistory).mockReturnValue(new Promise(() => {}));
    render(<HistoryTable walletAddress="GWALLET" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading staking history");
    expect(screen.getByRole("button", { name: "Refresh history" })).toBeDisabled();
    expect(getStakingHistory).toHaveBeenCalledWith("GWALLET");
  });

  it("shows the empty state when there is no history", async () => {
    vi.mocked(getStakingHistory).mockResolvedValue({ success: true, history: [] });
    render(<HistoryTable />);

    expect(await screen.findByRole("heading", { name: "No history yet" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error with a retry when the API reports failure", async () => {
    const user = userEvent.setup();
    vi.mocked(getStakingHistory)
      .mockResolvedValueOnce({ success: false, history: [] })
      .mockResolvedValue({ success: true, history: items });
    render(<HistoryTable />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Staking history is unavailable");
    expect(alert).toHaveTextContent("Failed to fetch staking history");

    await user.click(within(alert).getByRole("button", { name: "Reload ledger" }));
    expect(await screen.findByRole("table", { name: "Staking transaction history" })).toBeInTheDocument();
  });

  it("shows a connection error when the request rejects", async () => {
    vi.mocked(getStakingHistory).mockRejectedValue(new Error("offline"));
    render(<HistoryTable />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to connect and retrieve staking history");
  });

  it("renders each transaction with its type, amounts, rate and explorer link", async () => {
    vi.mocked(getStakingHistory).mockResolvedValue({ success: true, history: items });
    render(<HistoryTable />);

    const table = await screen.findByRole("table", { name: "Staking transaction history" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);

    expect(within(rows[0]).getByText("Staked")).toBeInTheDocument();
    expect(within(rows[0]).getByText("1,234,567.500000")).toBeInTheDocument();
    expect(within(rows[0]).getByText("₦1,851,851,250")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Rate: ₦1,500 / USDC")).toBeInTheDocument();
    const link = within(rows[0]).getByRole("link", { name: "ABCDEF...XYZ123" });
    expect(link).toHaveAttribute("href", `https://stellar.expert/explorer/public/tx/${TX}`);
    expect(link).toHaveAttribute("target", "_blank");

    expect(within(rows[1]).getByText("Unstaked")).toBeInTheDocument();
    expect(within(rows[1]).getByText("25.000000")).toBeInTheDocument();
    expect(within(rows[1]).getByText("—")).toBeInTheDocument();

    expect(within(rows[2]).getByText("Claimed Rewards")).toBeInTheDocument();
    expect(within(rows[2]).getByText("0.000000")).toBeInTheDocument();
  });

  it("refetches when the refresh button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getStakingHistory).mockResolvedValue({ success: true, history: [] });
    render(<HistoryTable />);

    await screen.findByRole("heading", { name: "No history yet" });
    await user.click(screen.getByRole("button", { name: "Refresh history" }));
    await waitFor(() => expect(getStakingHistory).toHaveBeenCalledTimes(2));
  });
});
