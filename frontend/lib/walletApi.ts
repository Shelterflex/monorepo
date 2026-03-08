import { apiFetch } from "./api";

export type TopUpRail = "paystack" | "flutterwave" | "bank_transfer";

export interface TopUpRequest {
  amountNgn: number;
  rail: TopUpRail;
}

export interface BankTransferDetails {
  accountNumber: string;
  accountName: string;
  bankName: string;
  reference: string;
}

export interface TopUpResponse {
  id: string;
  amountNgn: number;
  rail: TopUpRail;
  status: "pending" | "confirmed" | "failed";
  reference: string;
  redirectUrl?: string | null;
  bankTransfer?: BankTransferDetails | null;
  createdAt: string;
  expiresAt?: string | null;
}

export interface NgnBalanceResponse {
  availableNgn: number;
  heldNgn: number;
  totalNgn: number;
}

export type WalletLedgerType =
  | "top_up"
  | "withdrawal"
  | "staking_conversion"
  | "staking_reserve"
  | "staking_debit"
  | "staking_refund"
  | "reversal"
  | "reward"
  | string;

export type WalletLedgerStatus = "pending" | "approved" | "rejected" | "confirmed" | "failed";

export interface WalletLedgerEntry {
  id: string;
  type: string;
  amountNgn: number;
  status: WalletLedgerStatus;
  timestamp: string;
  reference?: string | null;
}

export interface WalletLedgerResponse {
  entries: WalletLedgerEntry[];
  nextCursor?: string | null;
}

export interface BankAccountDetails {
  accountNumber: string;
  accountName: string;
  bankName: string;
}

export interface WithdrawalRequest {
  amountNgn: number;
  bankAccount: BankAccountDetails;
}

export interface WithdrawalResponse {
  id: string;
  amountNgn: number;
  status: "pending" | "approved" | "rejected" | "confirmed" | "failed";
  bankAccount: BankAccountDetails;
  reference: string;
  createdAt: string;
  processedAt?: string | null;
  failureReason?: string | null;
}

export function getNgnBalance(): Promise<NgnBalanceResponse> {
  return apiFetch<NgnBalanceResponse>("/api/wallet/ngn/balance");
}

export function getNgnLedger(params?: {
  cursor?: string;
  limit?: number;
  type?: WalletLedgerType[];
}): Promise<WalletLedgerResponse> {
  const cursor = params?.cursor ?? "";
  const limit = params?.limit ?? 20;
  const types = params?.type ?? [];

  const qs = new URLSearchParams();
  if (cursor) qs.set("cursor", cursor);
  qs.set("limit", String(limit));
  types.forEach((t) => qs.append("type", t));

  return apiFetch<WalletLedgerResponse>(`/api/wallet/ngn/ledger?${qs.toString()}`);
}

export function initiateTopUp(payload: TopUpRequest): Promise<TopUpResponse> {
  return apiFetch<TopUpResponse>("/api/wallet/ngn/topup/initiate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function initiateWithdrawal(payload: WithdrawalRequest): Promise<WithdrawalResponse> {
  return apiFetch<WithdrawalResponse>("/api/wallet/ngn/withdraw/initiate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getWithdrawalHistory(params?: {
  cursor?: string;
  limit?: number;
}): Promise<{ entries: WithdrawalResponse[]; nextCursor?: string | null }> {
  const cursor = params?.cursor ?? "";
  const limit = params?.limit ?? 20;

  const qs = new URLSearchParams();
  if (cursor) qs.set("cursor", cursor);
  qs.set("limit", String(limit));

  return apiFetch<{ entries: WithdrawalResponse[]; nextCursor?: string | null }>(`/api/wallet/ngn/withdraw/history?${qs.toString()}`);
}
