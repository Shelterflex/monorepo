import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StakingClaimFlow } from "../StakingClaimFlow";
import { claimReward } from "@/lib/ngnStakingApi";

vi.mock("@/lib/ngnStakingApi", () => ({ claimReward: vi.fn() }));

const HASH = "a".repeat(20) + "MIDDLE" + "z".repeat(20);

function setup(props: Partial<React.ComponentProps<typeof StakingClaimFlow>> = {}) {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<StakingClaimFlow isOpen onClose={onClose} rewardAmount={1_250_000} {...props} />);
  return { user, onClose };
}

async function goToConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Proceed" }));
}

beforeEach(() => {
  vi.mocked(claimReward).mockReset();
});

describe("StakingClaimFlow", () => {
  it("shows the reward, gas fee and net amount", () => {
    setup();

    expect(screen.getByRole("dialog", { name: "Claim Staking Rewards" })).toBeInTheDocument();
    expect(screen.getByText("Rewards Amount").nextElementSibling).toHaveTextContent("₦1,250,000");
    expect(screen.getByText("Gas Fee").nextElementSibling).toHaveTextContent("₦50,000");
    expect(screen.getByText("You Receive").nextElementSibling).toHaveTextContent("₦1,200,000");
  });

  it("asks for confirmation before claiming, and can go back", async () => {
    const { user } = setup();

    await goToConfirm(user);
    expect(screen.getByText("Confirm Claim Details")).toBeInTheDocument();
    expect(claimReward).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Proceed" })).toBeInTheDocument();
  });

  it("shows a processing status while the claim is pending", async () => {
    vi.mocked(claimReward).mockReturnValue(new Promise(() => {}));
    const { user } = setup();

    await goToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Confirm Claim" }));

    expect(screen.getByRole("status")).toHaveTextContent("Processing");
    expect(screen.queryByRole("button", { name: "Confirm Claim" })).not.toBeInTheDocument();
  });

  it("shows a confirmed claim with a copyable hash", async () => {
    vi.mocked(claimReward).mockResolvedValue({ txId: HASH, status: "CONFIRMED" } as never);
    const { user, onClose } = setup();

    await goToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Confirm Claim" }));

    expect(await screen.findByRole("heading", { name: "Claim Confirmed" })).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText(/aaaaaaaaaaaaaaaaaaaa\.\.\./)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy transaction hash" }));
    expect(await navigator.clipboard.readText()).toBe(HASH);
    expect(screen.getByText("Copied!")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("labels a non-confirmed claim as queued for retry", async () => {
    vi.mocked(claimReward).mockResolvedValue({ txId: HASH, status: "PENDING" } as never);
    const { user } = setup();

    await goToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Confirm Claim" }));

    expect(await screen.findByText("Queued for retry")).toBeInTheDocument();
  });

  it("shows a failure and lets the user start over", async () => {
    vi.mocked(claimReward).mockRejectedValue(new Error("RPC down"));
    const { user, onClose } = setup();

    await goToConfirm(user);
    await user.click(screen.getByRole("button", { name: "Confirm Claim" }));

    expect(await screen.findByRole("heading", { name: "Claim Failed" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try Again" }));
    expect(screen.getByRole("button", { name: "Proceed" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("formats large reward amounts", () => {
    setup({ rewardAmount: 9_876_543_210 });

    expect(screen.getByText("You Receive").nextElementSibling).toHaveTextContent("₦9,876,493,210");
  });
});
