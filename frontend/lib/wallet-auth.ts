/**
 * Wallet Authentication Session Manager
 */

import { stellarWallet } from "@/lib/stellar-wallet";
import { requestWalletChallenge, verifyWalletSignature } from "@/lib/authApi";

export interface WalletSession {
  publicKey: string;
  network: string;
  token: string;
  expiresAt: number;
}

export class WalletAuthManager {
  private static instance?: WalletAuthManager;
  private session: WalletSession | null = null;
  private storageKey = "wallet_auth_session";

  private constructor() {
    this.restoreSession();
  }

  public static getInstance(): WalletAuthManager {
    if (!WalletAuthManager.instance) {
      WalletAuthManager.instance = new WalletAuthManager();
    }
    return WalletAuthManager.instance;
  }

  private restoreSession(): void {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) {
        this.session = null;
        return;
      }
      const parsed = JSON.parse(stored) as WalletSession;
      if (parsed.expiresAt && parsed.expiresAt > Date.now()) {
        this.session = parsed;
      } else {
        this.session = null;
        localStorage.removeItem(this.storageKey);
      }
    } catch {
      this.session = null;
    }
  }

  public async connectAndAuthenticate(): Promise<WalletSession> {
    const { publicKey, network } = await stellarWallet.connect();
    const { challengeXdr } = await requestWalletChallenge(publicKey);
    const signedXdr = await stellarWallet.signTransaction(challengeXdr);
    const { token } = await verifyWalletSignature(publicKey, signedXdr);

    const session: WalletSession = {
      publicKey,
      network: network || "testnet",
      token: token || "",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };

    this.session = session;
    if (typeof window !== "undefined") {
      localStorage.setItem(this.storageKey, JSON.stringify(session));
    }
    return session;
  }

  public getSession(): WalletSession | null {
    if (this.session && this.session.expiresAt && this.session.expiresAt <= Date.now()) {
      this.session = null;
      if (typeof window !== "undefined") {
        localStorage.removeItem(this.storageKey);
      }
      return null;
    }
    if (!this.session) {
      this.restoreSession();
    }
    return this.session;
  }

  public isAuthenticated(): boolean {
    return this.getSession() !== null;
  }

  public getAuthToken(): string | null {
    return this.getSession()?.token ?? null;
  }

  public async disconnect(): Promise<void> {
    await stellarWallet.disconnect();
    this.session = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem(this.storageKey);
    }
  }

  public async refreshIfNeeded(): Promise<void> {
    const session = this.getSession();
    if (!session) return;
    const oneHour = 60 * 60 * 1000;
    if (session.expiresAt - Date.now() < oneHour) {
      await this.connectAndAuthenticate();
    }
  }
}

export const walletAuthManager = WalletAuthManager.getInstance();
