import { apiPost } from "./api";
import { setToken } from "./auth";

export interface LoginRequest {
  email: string;
}

export interface LoginResponse {
  message: string;
}

export interface VerifyOtpRequest {
  email: string;
  otp: string;
}

export interface VerifyOtpResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: "tenant" | "landlord" | "agent";
  };
}

export interface WalletChallengeRequest {
  address: string;
}

export interface WalletChallengeResponse {
  message: string;
  nonce: string;
}

export interface WalletVerifyRequest {
  address: string;
  signature: string;
}

export interface WalletVerifyResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: "tenant" | "landlord" | "agent";
    walletAddress?: string;
  };
}

export async function requestOtp(email: string): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/auth/request-otp", { email });
}

export async function verifyOtp(
  email: string,
  otp: string
): Promise<VerifyOtpResponse> {
  const res = await apiPost<VerifyOtpResponse>("/auth/verify-otp", {
    email,
    otp,
  });
  setToken(res.token);
  return res;
}

export async function requestWalletChallenge(address: string): Promise<WalletChallengeResponse> {
  return apiPost<WalletChallengeResponse>("/auth/wallet/challenge", { address });
}

export async function verifyWalletSignature(
  address: string,
  signature: string
): Promise<WalletVerifyResponse> {
  const res = await apiPost<WalletVerifyResponse>("/auth/wallet/verify", {
    address,
    signature,
  });
  setToken(res.token);
  return res;
}