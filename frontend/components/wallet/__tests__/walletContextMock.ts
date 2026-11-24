import { vi } from "vitest";

/** Shape of useWallet() used by ConnectWalletButton and WalletStatusBadge. */
export function walletState(overrides: Record<string, unknown> = {}) {
  return {
    publicKey: null as string | null,
    address: null as string | null,
    connected: false,
    connecting: false,
    freighterInstalled: true,
    networkMismatch: false,
    walletLocked: false,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    signTransaction: vi.fn(async (xdr: string) => xdr),
    ...overrides,
  };
}

export const PUBLIC_KEY = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPWXYZ";
