import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { StakeForm } from "../StakeForm";
import { ACCOUNT_FROZEN_MESSAGE } from "@/lib/api";
import type { NgnBalanceResponse } from "@/lib/walletApi";
import type { Quote } from "@/lib/ngnStakingApi";

vi.mock("../ngn-flow/NgnStakingFlow", () => ({
  NgnStakingFlow: ({ onCancel }: { onCancel: () => void }) => (
    <div>
      NGN staking flow
      <button type="button" onClick={onCancel}>
        Cancel flow
      </button>
    </div>
  ),
}));

type Mode = "ngn_deposit" | "ngn_balance" | "usdc";

interface HarnessProps {
  mode?: Mode;
  isFrozen?: boolean;
  isLoadingBalance?: boolean;
  isStaking?: boolean;
  isLoadingQuote?: boolean;
  ngnBalance?: NgnBalanceResponse | null;
  status?: string;
  quoteError?: string | null;
  showNgnFlow?: boolean;
  ngnQuote?: Quote | null;
  handleStake?: () => Promise<void>;
  handleGetQuote?: () => Promise<void>;
}

const balance: NgnBalanceResponse = { availableNgn: 50_000, heldNgn: 2_500, totalNgn: 52_500 };

// StakeForm is fully controlled; this harness owns the state the page would.
function Harness(props: HarnessProps) {
  const [mode, setMode] = useState<Mode>(props.mode ?? "usdc");
  const [stakeAmount, setStakeAmount] = useState("");
  const [ngnDepositAmount, setNgnDepositAmount] = useState("");
  const [status, setStatus] = useState(props.status ?? "");
  const [quoteError, setQuoteError] = useState<string | null>(props.quoteError ?? null);
  return (
    <StakeForm
      isFrozen={props.isFrozen ?? false}
      isLoadingBalance={props.isLoadingBalance ?? false}
      isStaking={props.isStaking ?? false}
      ngnBalance={props.ngnBalance === undefined ? balance : props.ngnBalance}
      stakeAmount={stakeAmount}
      setStakeAmount={setStakeAmount}
      handleStake={props.handleStake ?? vi.fn()}
      stakingMode={mode}
      setStakingMode={setMode}
      status={status}
      setStatus={setStatus}
      ngnDepositAmount={ngnDepositAmount}
      setNgnDepositAmount={setNgnDepositAmount}
      ngnQuote={props.ngnQuote ?? null}
      setNgnQuote={vi.fn()}
      isLoadingQuote={props.isLoadingQuote ?? false}
      setIsLoadingQuote={vi.fn()}
      quoteError={quoteError}
      setQuoteError={setQuoteError}
      showNgnFlow={props.showNgnFlow ?? false}
      setShowNgnFlow={vi.fn()}
      handleGetQuote={props.handleGetQuote ?? vi.fn()}
      handleNgnFlowComplete={vi.fn()}
      handleNgnFlowCancel={vi.fn()}
    />
  );
}

describe("StakeForm — lock period and estimate", () => {
  it("defaults to the 180 day lock and lets the user pick another", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole("button", { name: /180 Days/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /365 Days/ }));
    expect(screen.getByRole("button", { name: /365 Days/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /180 Days/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows no estimate until a positive amount is entered", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByText(/Estimated Returns/)).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Amount (USDC)" }), "1000");

    expect(screen.getByText("Estimated Returns (180 days)")).toBeInTheDocument();
    // 1000 * 18.5% * 180/365
    expect(screen.getByText("+91.232877")).toBeInTheDocument();
    expect(screen.getByText("1,091.232877")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /30 Days/ }));
    expect(screen.getByText("Estimated Returns (30 days)")).toBeInTheDocument();
  });
});

describe("StakeForm — USDC amount validation", () => {
  it("keeps the stake button disabled for an empty or zero amount", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const stake = screen.getByRole("button", { name: "Stake USDC Directly" });

    expect(stake).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Amount (USDC)" }), "0");
    expect(stake).toBeDisabled();
    expect(screen.queryByText(/Estimated Returns/)).not.toBeInTheDocument();
  });

  it("keeps the stake button disabled for a negative amount", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole("textbox", { name: "Amount (USDC)" });
    // Typing "-" alone is rejected as NaN, but a pasted negative number is accepted.
    await user.type(input, "-");
    expect(input).toHaveValue("");
    await user.click(input);
    await user.paste("-5");
    expect(input).toHaveValue("-5");
    expect(screen.getByRole("button", { name: "Stake USDC Directly" })).toBeDisabled();
  });

  it("ignores non-numeric input", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Amount (USDC)" });

    await user.type(input, "12abc.5");
    expect(input).toHaveValue("12.5");
  });

  it("submits a valid amount", async () => {
    const user = userEvent.setup();
    const handleStake = vi.fn().mockResolvedValue(undefined);
    render(<Harness handleStake={handleStake} />);

    await user.type(screen.getByRole("textbox", { name: "Amount (USDC)" }), "100.5");
    await user.click(screen.getByRole("button", { name: "Stake USDC Directly" }));
    expect(handleStake).toHaveBeenCalledTimes(1);
  });

  it("disables the input and button while the stake is pending", () => {
    render(<Harness isStaking />);

    expect(screen.getByRole("textbox", { name: "Amount (USDC)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Processing Stake transaction..." })).toBeDisabled();
  });

  it("shows failures as an alert and progress as a status", () => {
    const { unmount } = render(<Harness status="Failed to submit stake" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to submit stake");
    unmount();

    render(<Harness status="Submitting stake transaction..." />);
    expect(screen.getByRole("status")).toHaveTextContent("Submitting stake transaction...");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("StakeForm — NGN balance tab", () => {
  it("announces while the balance loads", () => {
    render(<Harness mode="ngn_balance" isLoadingBalance />);

    expect(screen.getByRole("status", { name: "Loading NGN balance" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Amount (NGN)" })).not.toBeInTheDocument();
  });

  it("explains a frozen account instead of offering the form", () => {
    render(<Harness mode="ngn_balance" isFrozen />);

    expect(screen.getByText(ACCOUNT_FROZEN_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stake from NGN Balance" })).not.toBeInTheDocument();
  });

  it("shows a load error when the balance is unavailable", () => {
    render(<Harness mode="ngn_balance" ngnBalance={null} />);

    expect(screen.getByText("Failed to load NGN balance")).toBeInTheDocument();
  });

  it("shows available and held balances with the max hint", () => {
    render(<Harness mode="ngn_balance" />);

    expect(screen.getByText("Available NGN Balance").nextElementSibling).toHaveTextContent("₦50,000");
    expect(screen.getByText("Held (Pending)").nextElementSibling).toHaveTextContent("₦2,500");
    expect(screen.getByText("Min: ₦100 · Max: ₦50,000")).toBeInTheDocument();
    const input = screen.getByRole("spinbutton", { name: "Amount (NGN)" });
    expect(input).toHaveAttribute("max", "50000");
  });

  it("hides the held row when nothing is held, and handles a zero balance", () => {
    render(<Harness mode="ngn_balance" ngnBalance={{ availableNgn: 0, heldNgn: 0, totalNgn: 0 }} />);

    expect(screen.queryByText("Held (Pending)")).not.toBeInTheDocument();
    expect(screen.getByText("Available NGN Balance").nextElementSibling).toHaveTextContent("₦0");
  });

  it("disables staking for a zero amount and enables it for a positive one", async () => {
    const user = userEvent.setup();
    render(<Harness mode="ngn_balance" />);
    const input = screen.getByRole("spinbutton", { name: "Amount (NGN)" });

    await user.type(input, "0");
    expect(screen.getByRole("button", { name: "Stake from NGN Balance" })).toBeDisabled();
    await user.clear(input);
    await user.type(input, "5000");
    expect(screen.getByRole("button", { name: "Stake from NGN Balance" })).toBeEnabled();
    // 5000 NGN / 1500 ≈ 3.333333 USDC principal
    expect(screen.getByText("3.333333")).toBeInTheDocument();
  });

  it("shows an insufficient-balance message as an alert", () => {
    render(<Harness mode="ngn_balance" status="Insufficient NGN balance. Available: ₦50,000" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Insufficient NGN balance. Available: ₦50,000");
  });

  it("disables the form while staking", () => {
    render(<Harness mode="ngn_balance" isStaking />);

    expect(screen.getByRole("spinbutton", { name: "Amount (NGN)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Processing transaction..." })).toBeDisabled();
  });
});

describe("StakeForm — NGN deposit tab", () => {
  it("requires at least ₦100 before requesting a quote", async () => {
    const user = userEvent.setup();
    const handleGetQuote = vi.fn().mockResolvedValue(undefined);
    render(<Harness mode="ngn_deposit" handleGetQuote={handleGetQuote} />);
    const input = screen.getByRole("spinbutton", { name: "Amount (NGN)" });
    const request = screen.getByRole("button", { name: "Request FX Quote & Stake" });

    await user.type(input, "99");
    expect(request).toBeDisabled();
    await user.type(input, "0");
    expect(request).toBeEnabled();
    await user.click(request);
    expect(handleGetQuote).toHaveBeenCalledTimes(1);
  });

  it("shows a quote error as an alert and clears it when the amount changes", async () => {
    const user = userEvent.setup();
    render(<Harness mode="ngn_deposit" quoteError="Quote service unavailable" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Quote service unavailable");
    await user.type(screen.getByRole("spinbutton", { name: "Amount (NGN)" }), "5");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the form while the quote is loading", () => {
    render(<Harness mode="ngn_deposit" isLoadingQuote />);

    expect(screen.getByRole("spinbutton", { name: "Amount (NGN)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Requesting FX Quote..." })).toBeDisabled();
  });

  it("hands over to the NGN staking flow once a quote exists", () => {
    render(<Harness mode="ngn_deposit" showNgnFlow ngnQuote={{} as Quote} />);

    expect(screen.getByText("NGN staking flow")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Amount (NGN)" })).not.toBeInTheDocument();
  });
});

describe("StakeForm — funding tabs", () => {
  it("switches between funding sources", async () => {
    const user = userEvent.setup();
    render(<Harness mode="usdc" />);

    expect(screen.getByRole("tab", { name: "USDC Directly" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "NGN Balance" }));
    expect(screen.getByRole("tab", { name: "NGN Balance" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Stake from NGN Balance" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "NGN Deposit" }));
    expect(screen.getByRole("button", { name: "Request FX Quote & Stake" })).toBeInTheDocument();
  });
});
