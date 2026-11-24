import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WalletStatusBadge } from "../WalletStatusBadge";
import { useWallet } from "@/contexts/WalletContext";
import { PUBLIC_KEY, walletState } from "./walletContextMock";

vi.mock("@/contexts/WalletContext", () => ({ useWallet: vi.fn() }));

function renderWith(overrides: Record<string, unknown> = {}) {
  vi.mocked(useWallet).mockReturnValue(walletState(overrides) as never);
  return render(<WalletStatusBadge />);
}

describe("WalletStatusBadge", () => {
  it("shows No Wallet when the extension is missing, even if otherwise connected", () => {
    renderWith({ freighterInstalled: false, connected: true, publicKey: PUBLIC_KEY });

    expect(screen.getByText("No Wallet")).toBeInTheDocument();
    expect(screen.queryByText("GABC...WXYZ")).not.toBeInTheDocument();
  });

  it("shows Connecting while a connection is in progress", () => {
    renderWith({ connecting: true });

    expect(screen.getByText("Connecting")).toBeInTheDocument();
  });

  it("shows the truncated key when connected", () => {
    renderWith({ connected: true, publicKey: PUBLIC_KEY });

    expect(screen.getByText("GABC...WXYZ")).toBeInTheDocument();
  });

  it("shows Disconnected otherwise", () => {
    renderWith();

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("shows Disconnected when connected but no key is known", () => {
    renderWith({ connected: true, publicKey: null });

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });
});
