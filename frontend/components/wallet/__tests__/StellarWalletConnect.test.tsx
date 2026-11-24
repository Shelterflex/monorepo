import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StellarWalletConnect } from "../StellarWalletConnect";
import { stellarWallet } from "@/lib/stellar-wallet";
import { requestWalletChallenge, verifyWalletSignature } from "@/lib/authApi";
import { PUBLIC_KEY } from "./walletContextMock";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/stellar-wallet", () => ({
  stellarWallet: { connect: vi.fn(), signTransaction: vi.fn() },
}));
vi.mock("@/lib/authApi", () => ({
  requestWalletChallenge: vi.fn(),
  verifyWalletSignature: vi.fn(),
}));

beforeEach(() => {
  push.mockReset();
  vi.mocked(stellarWallet.connect).mockReset().mockResolvedValue({ publicKey: PUBLIC_KEY } as never);
  vi.mocked(stellarWallet.signTransaction).mockReset().mockResolvedValue("SIGNED_XDR");
  vi.mocked(requestWalletChallenge).mockReset().mockResolvedValue({ challengeXdr: "CHALLENGE_XDR" } as never);
  vi.mocked(verifyWalletSignature).mockReset().mockResolvedValue({} as never);
});

function setup() {
  const user = userEvent.setup();
  const onSuccess = vi.fn();
  render(<StellarWalletConnect onSuccess={onSuccess} />);
  return { user, onSuccess, button: () => screen.getByRole("button", { name: /wallet|signing/i }) };
}

describe("StellarWalletConnect", () => {
  it("starts disconnected with no alerts", () => {
    setup();

    expect(screen.getByRole("button", { name: "Connect Stellar Wallet" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("connects, signs the challenge, verifies and redirects", async () => {
    const { user, onSuccess } = setup();

    await user.click(screen.getByRole("button", { name: "Connect Stellar Wallet" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(requestWalletChallenge).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(stellarWallet.signTransaction).toHaveBeenCalledWith("CHALLENGE_XDR");
    expect(verifyWalletSignature).toHaveBeenCalledWith(PUBLIC_KEY, "SIGNED_XDR");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(`Connected: ${PUBLIC_KEY.slice(0, 6)}...${PUBLIC_KEY.slice(-4)}`);
  });

  it("disables the button while connecting", async () => {
    vi.mocked(stellarWallet.connect).mockReturnValue(new Promise(() => {}));
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Connect Stellar Wallet" }));
    expect(screen.getByRole("button", { name: "Connecting wallet..." })).toBeDisabled();
  });

  it("shows a signing state while waiting for the signature", async () => {
    vi.mocked(stellarWallet.signTransaction).mockReturnValue(new Promise(() => {}));
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Connect Stellar Wallet" }));
    expect(await screen.findByRole("button", { name: "Signing transaction..." })).toBeDisabled();
  });

  it("shows an error when the wallet extension is missing", async () => {
    vi.mocked(stellarWallet.connect).mockRejectedValue(new Error("Freighter wallet is not installed"));
    const { user, onSuccess } = setup();

    await user.click(screen.getByRole("button", { name: "Connect Stellar Wallet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Freighter wallet is not installed");
    expect(requestWalletChallenge).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Connect Stellar Wallet" })).toBeEnabled();
  });

  it("shows an error and does not verify when the user rejects the signature", async () => {
    vi.mocked(stellarWallet.signTransaction).mockRejectedValue(new Error("User declined access"));
    const { user, onSuccess } = setup();

    await user.click(screen.getByRole("button", { name: "Connect Stellar Wallet" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("User declined access");
    // The "Connected" confirmation is cleared on failure.
    expect(screen.queryByText(/^Connected:/)).not.toBeInTheDocument();
    expect(verifyWalletSignature).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("shows an error when the backend rejects the signature", async () => {
    vi.mocked(verifyWalletSignature).mockRejectedValue(new Error("Invalid signature"));
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Connect Stellar Wallet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid signature");
    expect(push).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for non-Error failures", async () => {
    vi.mocked(requestWalletChallenge).mockRejectedValue("nope");
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Connect Stellar Wallet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Stellar wallet connection failed");
  });

  it("clears a previous error on retry", async () => {
    vi.mocked(stellarWallet.connect)
      .mockRejectedValueOnce(new Error("Freighter wallet is not installed"))
      .mockReturnValue(new Promise(() => {}));
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Connect Stellar Wallet" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Connect Stellar Wallet" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
