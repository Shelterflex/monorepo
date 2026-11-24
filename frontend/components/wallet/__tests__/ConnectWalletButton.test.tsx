import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectWalletButton } from "../ConnectWalletButton";
import { useWallet } from "@/contexts/WalletContext";
import { PUBLIC_KEY, walletState } from "./walletContextMock";

vi.mock("@/contexts/WalletContext", () => ({ useWallet: vi.fn() }));

function renderWith(overrides: Record<string, unknown> = {}) {
  const state = walletState(overrides);
  vi.mocked(useWallet).mockReturnValue(state as never);
  render(<ConnectWalletButton />);
  return state;
}

describe("ConnectWalletButton", () => {
  it("links to the Freighter install page when the extension is missing", () => {
    renderWith({ freighterInstalled: false });

    const link = screen.getByRole("link", { name: "Install Freighter" });
    expect(link).toHaveAttribute("href", expect.stringContaining("chrome.google.com/webstore"));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("button", { name: "Connect Wallet" })).not.toBeInTheDocument();
  });

  it("connects a disconnected wallet", async () => {
    const user = userEvent.setup();
    const state = renderWith();

    const button = screen.getByRole("button", { name: "Connect Wallet" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(state.connect).toHaveBeenCalledTimes(1);
  });

  it("disables the button while connecting", () => {
    renderWith({ connecting: true });

    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeDisabled();
  });

  it("asks the user to unlock a locked wallet", async () => {
    const user = userEvent.setup();
    const state = renderWith({ walletLocked: true });

    const unlock = screen.getByRole("button", { name: "Unlock Freighter" });
    expect(unlock).toHaveAttribute("title", expect.stringContaining("locked"));
    await user.click(unlock);
    expect(state.connect).toHaveBeenCalledTimes(1);
  });

  it("shows the truncated key and disconnects a connected wallet", async () => {
    const user = userEvent.setup();
    const state = renderWith({ connected: true, publicKey: PUBLIC_KEY });

    expect(screen.getByText("GABC...WXYZ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Wallet" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Disconnect wallet" }));
    expect(state.disconnect).toHaveBeenCalledTimes(1);
  });

  it("warns about the wrong network and disconnects on click", async () => {
    const user = userEvent.setup();
    const state = renderWith({ connected: true, publicKey: PUBLIC_KEY, networkMismatch: true });

    const wrong = screen.getByRole("button", { name: "Wrong Network — switch to Testnet" });
    await user.click(wrong);
    expect(state.disconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("GABC...WXYZ")).not.toBeInTheDocument();
  });

  it("treats connected-without-a-key as disconnected", () => {
    renderWith({ connected: true, publicKey: null });

    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument();
  });
});
