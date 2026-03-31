import { stellarWallet } from "./stellar-wallet";
import { requestWalletChallenge, verifyWalletSignature } from "./authApi";

export interface WalletAuthSession {
  publicKey: string;
  network: string;
  token: string;
  expiresAt: number;
}

const SESSION_STORAGE_KEY = "wallet_auth_session";
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export class WalletAuthManager {
  private static instance: WalletAuthManager;
  private session: WalletAuthSession | null = null;

  private constructor() {
    this.loadSession();
  }

  static getInstance(): WalletAuthManager {
    if (!WalletAuthManager.instance) {
      WalletAuthManager.instance = new WalletAuthManager();
    }
    return WalletAuthManager.instance;
  }

  private loadSession(): void {
    if (typeof window === "undefined") return;

    try {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const session = JSON.parse(stored) as WalletAuthSession;
        if (session.expiresAt > Date.now()) {
          this.session = session;
        } else {
          this.clearSession();
        }
      }
    } catch (error) {
      console.error("Failed to load wallet session:", error);
      this.clearSession();
    }
  }

  private saveSession(session: WalletAuthSession): void {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      this.session = session;
    } catch (error) {
      console.error("Failed to save wallet session:", error);
    }
  }

  private clearSession(): void {
    if (typeof window === "undefined") return;

    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      this.session = null;
    } catch (error) {
      console.error("Failed to clear wallet session:", error);
    }
  }

  async connectAndAuthenticate(): Promise<WalletAuthSession> {
    try {
      // Step 1: Connect wallet
      const walletInfo = await stellarWallet.connect();

      // Step 2: Request challenge from backend
      const challenge = await requestWalletChallenge(walletInfo.publicKey);

      // Step 3: Sign challenge with wallet
      const signedChallengeXdr = await stellarWallet.signTransaction(
        challenge.challengeXdr
      );

      // Step 4: Verify signature and get session token
      const verifyResponse = await verifyWalletSignature(
        walletInfo.publicKey,
        signedChallengeXdr
      );

      // Step 5: Create and persist session
      const session: WalletAuthSession = {
        publicKey: walletInfo.publicKey,
        network: walletInfo.network || "testnet",
        token: verifyResponse.token,
        expiresAt: Date.now() + SESSION_DURATION_MS,
      };

      this.saveSession(session);
      return session;
    } catch (error) {
      console.error("Wallet authentication failed:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await stellarWallet.disconnect();
    this.clearSession();
  }

  getSession(): WalletAuthSession | null {
    if (this.session && this.session.expiresAt > Date.now()) {
      return this.session;
    }
    this.clearSession();
    return null;
  }

  isAuthenticated(): boolean {
    return this.getSession() !== null;
  }

  getAuthToken(): string | null {
    const session = this.getSession();
    return session?.token || null;
  }

  async refreshIfNeeded(): Promise<void> {
    const session = this.getSession();
    if (!session) return;

    const timeUntilExpiry = session.expiresAt - Date.now();
    const refreshThreshold = 60 * 60 * 1000; // 1 hour

    if (timeUntilExpiry < refreshThreshold) {
      try {
        await this.connectAndAuthenticate();
      } catch (error) {
        console.error("Session refresh failed:", error);
        this.clearSession();
      }
    }
  }
}

export const walletAuthManager = WalletAuthManager.getInstance();
