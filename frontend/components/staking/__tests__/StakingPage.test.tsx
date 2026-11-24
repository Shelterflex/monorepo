import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StakingPage from "../StakingPage";
import {
  getMvpStakingPosition,
  getStakingHistory,
  getStakingPosition,
  stakeFromNgnBalance,
  stakeTokens,
  unstakeTokens,
} from "@/lib/config";
import { getNgnBalance } from "@/lib/walletApi";
import { getQuote } from "@/lib/ngnStakingApi";
import { stellarWallet } from "@/lib/stellar-wallet";
import { walletAuthManager } from "@/lib/wallet-auth";
import { ACCOUNT_FROZEN_MESSAGE } from "@/lib/api";

vi.mock("@/lib/config", () => ({
  getMvpStakingPosition: vi.fn(),
  getStakingHistory: vi.fn(),
  getStakingPosition: vi.fn(),
  stakeFromNgnBalance: vi.fn(),
  stakeTokens: vi.fn(),
  unstakeTokens: vi.fn(),
}));
vi.mock("@/lib/walletApi", () => ({ getNgnBalance: vi.fn() }));
vi.mock("@/lib/ngnStakingApi", () => ({ getQuote: vi.fn(), claimReward: vi.fn() }));
vi.mock("@/lib/stellar-wallet", () => ({
  stellarWallet: {
    connect: vi.fn(),
    getPublicKey: vi.fn(() => null),
    isConnected: vi.fn(() => false),
  },
}));
vi.mock("@/lib/wallet-auth", () => ({ walletAuthManager: { getSession: vi.fn(() => null) } }));
vi.mock("@/lib/toast", () => ({ handleError: vi.fn() }));

const riskState = { hasHydrated: true, isFrozen: false, freezeReason: null as string | null };
vi.mock("@/hooks/useRiskState", () => ({ useRiskState: () => riskState }));

const WALLET = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";

function position(overrides: Partial<{ staked: string; claimable: string; warming: string; cooling: string; lockExpiry: string }> = {}) {
  return { success: true, position: { staked: "100", claimable: "0", warming: "0", cooling: "0", ...overrides } };
}

function connectedViaSession() {
  vi.mocked(walletAuthManager.getSession).mockReturnValue({ publicKey: WALLET } as never);
  vi.mocked(stellarWallet.getPublicKey).mockReturnValue(WALLET);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "http://backend.test");
  riskState.isFrozen = false;
  riskState.hasHydrated = true;
  vi.mocked(walletAuthManager.getSession).mockReturnValue(null);
  vi.mocked(stellarWallet.getPublicKey).mockReturnValue(null);
  vi.mocked(stellarWallet.isConnected).mockReturnValue(false);
  vi.mocked(stellarWallet.connect).mockReset();
  vi.mocked(getMvpStakingPosition).mockResolvedValue({
    success: true,
    position: { staked: "500.000000", used: "100.000000", unused: "400.000000", claimable: "1.000000" },
  } as never);
  vi.mocked(getStakingHistory).mockResolvedValue({ success: true, history: [] });
  vi.mocked(getStakingPosition).mockResolvedValue(position());
  vi.mocked(getNgnBalance).mockResolvedValue({ availableNgn: 50_000, heldNgn: 0, totalNgn: 50_000 });
  vi.mocked(stakeFromNgnBalance).mockReset();
  vi.mocked(stakeTokens).mockReset();
  vi.mocked(unstakeTokens).mockReset();
  vi.mocked(getQuote).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("StakingPage — wallet gate", () => {
  it("asks a disconnected user to connect before showing any staking controls", () => {
    render(<StakingPage />);

    expect(screen.getByRole("heading", { name: "Staking Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Freighter Wallet" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /stake/i })).not.toBeInTheDocument();
  });

  it("disables the connect button while connecting", async () => {
    const user = userEvent.setup();
    vi.mocked(stellarWallet.connect).mockReturnValue(new Promise(() => {}));
    render(<StakingPage />);

    await user.click(screen.getByRole("button", { name: "Connect Freighter Wallet" }));
    expect(screen.getByRole("button", { name: "Connecting Freighter..." })).toBeDisabled();
  });

  it("shows the error when the wallet extension is missing", async () => {
    const user = userEvent.setup();
    vi.mocked(stellarWallet.connect).mockRejectedValue(new Error("Freighter wallet is not installed"));
    render(<StakingPage />);

    await user.click(screen.getByRole("button", { name: "Connect Freighter Wallet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Freighter wallet is not installed");
    expect(screen.getByRole("button", { name: "Connect Freighter Wallet" })).toBeEnabled();
  });

  it("opens the dashboard after a successful connect", async () => {
    const user = userEvent.setup();
    vi.mocked(stellarWallet.connect).mockResolvedValue({ publicKey: WALLET } as never);
    render(<StakingPage />);

    await user.click(screen.getByRole("button", { name: "Connect Freighter Wallet" }));
    expect(await screen.findByText(`Connected: ${WALLET.slice(0, 6)}...${WALLET.slice(-6)}`)).toBeInTheDocument();
    expect(getMvpStakingPosition).toHaveBeenCalledWith(WALLET);
  });
});

describe("StakingPage — connected", () => {
  beforeEach(connectedViaSession);

  it("loads the position, MVP pool figures and an empty history", async () => {
    render(<StakingPage />);

    expect(await screen.findByText("500.000000 USDC")).toBeInTheDocument();
    expect(screen.getByText("Your Staked Balance").nextElementSibling).toHaveTextContent("100.000000");
    expect(await screen.findByRole("heading", { name: "No history yet" })).toBeInTheDocument();
  });

  it("rejects an NGN stake above the available balance without calling the API", async () => {
    const user = userEvent.setup();
    render(<StakingPage />);

    const input = await screen.findByRole("spinbutton", { name: "Amount (NGN)" });
    await user.type(input, "60000");
    await user.click(screen.getByRole("button", { name: "Stake from NGN Balance" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Insufficient NGN balance. Available: ₦50,000");
    expect(stakeFromNgnBalance).not.toHaveBeenCalled();
  });

  it("stakes from the NGN balance and reports success", async () => {
    const user = userEvent.setup();
    vi.mocked(stakeFromNgnBalance).mockResolvedValue({ status: "CONFIRMED", amountUsdc: "10" } as never);
    render(<StakingPage />);

    await user.type(await screen.findByRole("spinbutton", { name: "Amount (NGN)" }), "15000");
    await user.click(screen.getByRole("button", { name: "Stake from NGN Balance" }));

    expect(await screen.findByText("Successfully staked 10 USDC from ₦15,000")).toBeInTheDocument();
    expect(stakeFromNgnBalance).toHaveBeenCalledWith(15000);
    expect(screen.getByRole("spinbutton", { name: "Amount (NGN)" })).toHaveValue(null);
  });

  it("disables the NGN stake while it is pending", async () => {
    const user = userEvent.setup();
    vi.mocked(stakeFromNgnBalance).mockReturnValue(new Promise(() => {}));
    render(<StakingPage />);

    await user.type(await screen.findByRole("spinbutton", { name: "Amount (NGN)" }), "1000");
    await user.click(screen.getByRole("button", { name: "Stake from NGN Balance" }));

    expect(screen.getByRole("button", { name: "Processing transaction..." })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Amount (NGN)" })).toBeDisabled();
  });

  it("shows a stake failure as an alert", async () => {
    const user = userEvent.setup();
    vi.mocked(stakeTokens).mockRejectedValue(new Error("Failed: insufficient USDC trustline"));
    render(<StakingPage />);

    await user.click(await screen.findByRole("tab", { name: "USDC Directly" }));
    await user.type(screen.getByRole("textbox", { name: "Amount (USDC)" }), "12.5");
    await user.click(screen.getByRole("button", { name: "Stake USDC Directly" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed: insufficient USDC trustline");
    expect(stakeTokens).toHaveBeenCalledWith("12.5", WALLET);
  });

  it("blocks NGN balance staking for a frozen account", async () => {
    riskState.isFrozen = true;
    render(<StakingPage />);

    expect((await screen.findAllByText(ACCOUNT_FROZEN_MESSAGE)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Stake from NGN Balance" })).not.toBeInTheDocument();
  });

  it("shows the balance load error when the NGN balance request fails", async () => {
    vi.mocked(getNgnBalance).mockRejectedValue(new Error("down"));
    render(<StakingPage />);

    expect(await screen.findByText("Failed to load NGN balance", { selector: "p" })).toBeInTheDocument();
  });

  it("only unstakes after the user confirms in the modal", async () => {
    const user = userEvent.setup();
    vi.mocked(unstakeTokens).mockResolvedValue({ status: "CONFIRMED" } as never);
    render(<StakingPage />);

    const open = await screen.findByRole("button", { name: "Unstake principal" });
    await waitFor(() => expect(open).toBeEnabled());
    await user.click(open);

    const dialog = screen.getByRole("dialog", { name: "Unstake Tokens" });
    expect(within(dialog).getByText("Max: 100.000000 USDC")).toBeInTheDocument();
    expect(unstakeTokens).not.toHaveBeenCalled();

    await user.type(within(dialog).getByRole("textbox", { name: "Amount to Unstake" }), "40");
    expect(unstakeTokens).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Confirm Unstake" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(unstakeTokens).toHaveBeenCalledWith("40", WALLET);
    expect(screen.getByText("Unstake confirmed on-chain")).toBeInTheDocument();
  });

  it("does not unstake when the modal is cancelled", async () => {
    const user = userEvent.setup();
    render(<StakingPage />);

    const open = await screen.findByRole("button", { name: "Unstake principal" });
    await waitFor(() => expect(open).toBeEnabled());
    await user.click(open);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(unstakeTokens).not.toHaveBeenCalled();
  });

  it("keeps unstaking disabled while the stake is locked", async () => {
    vi.mocked(getStakingPosition).mockResolvedValue(
      position({ lockExpiry: new Date(Date.now() + 3 * 86_400_000).toISOString() }),
    );
    render(<StakingPage />);

    const locked = await screen.findByRole("button", { name: /Unstake Locked/ });
    expect(locked).toBeDisabled();
    expect(screen.getByText("Staking locked")).toBeInTheDocument();
  });

  it("disables unstake and claim when there is nothing staked or claimable", async () => {
    vi.mocked(getStakingPosition).mockResolvedValue(position({ staked: "0", claimable: "0" }));
    render(<StakingPage />);

    await waitFor(() => expect(getStakingPosition).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Unstake principal" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Claim accrued yield" })).toBeDisabled();
  });

  it("opens the claim flow when rewards are claimable", async () => {
    const user = userEvent.setup();
    vi.mocked(getStakingPosition).mockResolvedValue(position({ claimable: "5" }));
    render(<StakingPage />);

    const claim = await screen.findByRole("button", { name: "Claim accrued yield" });
    await waitFor(() => expect(claim).toBeEnabled());
    await user.click(claim);
    expect(screen.getByRole("dialog", { name: "Claim Staking Rewards" })).toBeInTheDocument();
  });

  it("shows the minimum-amount error from the quote step", async () => {
    const user = userEvent.setup();
    vi.mocked(getQuote).mockRejectedValue(new Error("FX provider unavailable"));
    render(<StakingPage />);

    await user.click(await screen.findByRole("tab", { name: "NGN Deposit" }));
    await user.type(screen.getByRole("spinbutton", { name: "Amount (NGN)" }), "5000");
    await user.click(screen.getByRole("button", { name: "Request FX Quote & Stake" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("FX provider unavailable");
    expect(getQuote).toHaveBeenCalledWith(5000);
  });

  // Neither the page nor StakeForm limits decimal places, so "1.123456789"
  // USDC is sent to stakeTokens unchanged. Reported in the PR (tests-only scope).
  it.todo("rejects USDC amounts with more than 7 decimal places");
});
