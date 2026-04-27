/**
 * Tenant API Client
 * Handles tenant application and payment operations
 */

import { apiGet, apiPost } from "./apiClient";

// ── Tenant Onboarding Types ────────────────────────────────────────────────

export interface TenantOnboardingData {
  identity: {
    fullName: string;
    occupation: string;
    email: string;
    phone: string;
    address: string;
  };
  kyc: {
    documentType: string;
    documentUrl?: string;
    status: "pending" | "verified" | "rejected";
  };
  wallet: {
    address: string;
    connected: boolean;
  };
  notifications: {
    paymentReminders: boolean;
    paymentConfirmations: boolean;
    leaseUpdates: boolean;
    messages: boolean;
  };
  currentStep: number;
}

export interface OnboardingResponse {
  success: boolean;
  data: TenantOnboardingData;
}

// ── Tenant Application Types ────────────────────────────────────────────────

export interface TenantApplication {
  applicationId: string;
  userId: string;
  propertyId: number;
  propertyTitle?: string;
  propertyLocation?: string;
  annualRent: number;
  deposit: number;
  duration: number;
  totalAmount: number;
  monthlyPayment: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  hasAgreedToTerms: boolean;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
}

export interface CreateApplicationRequest {
  propertyId: number;
  annualRent: number;
  deposit: number;
  duration: number;
  hasAgreedToTerms: boolean;
  propertyTitle?: string;
  propertyLocation?: string;
}

export interface CreateApplicationResponse {
  success: boolean;
  data: TenantApplication;
}

export interface GetApplicationResponse {
  success: boolean;
  data: TenantApplication;
}

export interface ListApplicationsResponse {
  success: boolean;
  data: TenantApplication[];
  nextCursor?: string;
}

// ── Tenant Payment Types ────────────────────────────────────────────────────

export interface PaymentScheduleItem {
  period: number;
  month: string;
  amount: number;
  dueDate: string;
  status: "paid" | "upcoming" | "pending";
  paidDate?: string;
}

export interface PaymentScheduleResponse {
  success: boolean;
  data: {
    schedule: PaymentScheduleItem[];
    nextPayment: PaymentScheduleItem | null;
    dealId?: string;
  };
}

export interface PaymentHistoryItem {
  id: string;
  dealId: string;
  month: string;
  amount: number;
  status: "paid";
  paidDate: string;
  method: string;
  timestamp: string;
}

export interface PaymentHistoryResponse {
  success: boolean;
  data: {
    payments: PaymentHistoryItem[];
  };
}

export interface WalletBalanceResponse {
  success: boolean;
  data: {
    balance: number;
    availableNgn: number;
    heldNgn: number;
    totalNgn: number;
    lastTopUp: string;
    autoPayEnabled: boolean;
  };
}

export interface QuickPayRequest {
  dealId: string;
  amount: number;
  paymentMethod: "wallet" | "card";
}

export interface QuickPayResponse {
  success: boolean;
  data: {
    paymentId: string;
    status: "pending" | "confirmed" | "failed";
    amount: number;
    method: string;
    redirectUrl?: string;
    message: string;
  };
}

export interface WalletTopUpRequest {
  amount: number;
  paymentMethod: "card" | "bank_transfer";
}

export interface WalletTopUpResponse {
  success: boolean;
  data: {
    topUpId: string;
    amount: number;
    status: "pending" | "confirmed" | "failed";
    reference: string;
    redirectUrl?: string | null;
    bankTransfer?: {
      accountNumber: string;
      accountName: string;
      bankName: string;
      reference: string;
    } | null;
    expiresAt?: string | null;
  };
}

export type DisputeReason =
  | "amount_discrepancy"
  | "duplicate_charge"
  | "service_not_received"
  | "early_termination"
  | "property_issue"
  | "other";

export interface PaymentDispute {
  id: string;
  paymentId: string;
  reason: DisputeReason;
  description: string;
  status: "pending" | "under_review" | "resolved" | "rejected";
  resolution?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDisputeRequest {
  paymentId: string;
  reason: DisputeReason;
  description: string;
  evidenceKeys?: string[];
}

export async function getMyDisputes(): Promise<{ disputes: PaymentDispute[] }> {
  return apiGet<{ disputes: PaymentDispute[] }>("/api/tenant/payments/disputes");
}

export async function createDispute(
  data: CreateDisputeRequest,
): Promise<{ success: boolean; disputeId: string }> {
  return apiPost<{ success: boolean; disputeId: string }>(
    "/api/tenant/payments/disputes",
    data,
  );
}

// ── Application API Functions ───────────────────────────────────────────────

export async function createTenantApplication(
  data: CreateApplicationRequest,
): Promise<CreateApplicationResponse> {
  return apiPost<CreateApplicationResponse>("/api/tenant/applications", data);
}

export async function getTenantApplication(
  applicationId: string,
): Promise<GetApplicationResponse> {
  return apiGet<GetApplicationResponse>(
    `/api/tenant/applications/${applicationId}`,
  );
}

export async function listTenantApplications(params?: {
  status?: "pending" | "approved" | "rejected" | "cancelled";
  limit?: number;
  cursor?: string;
}): Promise<ListApplicationsResponse> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.limit) query.set("limit", params.limit.toString());
  if (params?.cursor) query.set("cursor", params.cursor);

  const path = `/api/tenant/applications${query.toString() ? `?${query.toString()}` : ""}`;
  return apiGet<ListApplicationsResponse>(path);
}

// ── Payment API Functions ───────────────────────────────────────────────────

export async function getPaymentSchedule(): Promise<PaymentScheduleResponse> {
  return apiGet<PaymentScheduleResponse>("/api/tenant/payments/schedule");
}

export async function getPaymentHistory(params?: {
  limit?: number;
  cursor?: string;
}): Promise<PaymentHistoryResponse> {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", params.limit.toString());
  if (params?.cursor) query.set("cursor", params.cursor);

  const path = `/api/tenant/payments/history${query.toString() ? `?${query.toString()}` : ""}`;
  return apiGet<PaymentHistoryResponse>(path);
}

export async function getWalletBalance(): Promise<WalletBalanceResponse> {
  return apiGet<WalletBalanceResponse>("/api/tenant/payments/wallet");
}

export async function initiateQuickPay(
  data: QuickPayRequest,
): Promise<QuickPayResponse> {
  return apiPost<QuickPayResponse>("/api/tenant/payments/quick-pay", data);
}

export async function initiateWalletTopUp(
  data: WalletTopUpRequest,
): Promise<WalletTopUpResponse> {
  return apiPost<WalletTopUpResponse>(
    "/api/tenant/payments/wallet/topup",
    data,
  );
}

// ── Onboarding API Functions ───────────────────────────────────────────────

export async function getOnboardingProgress(): Promise<OnboardingResponse> {
  return apiGet<OnboardingResponse>("/api/tenant/onboarding");
}

export async function saveOnboardingProgress(
  data: Partial<TenantOnboardingData>,
): Promise<OnboardingResponse> {
  return apiPost<OnboardingResponse>("/api/tenant/onboarding/save", data);
}

export async function submitOnboarding(
  data: TenantOnboardingData,
): Promise<OnboardingResponse> {
  return apiPost<OnboardingResponse>("/api/tenant/onboarding/submit", data);
}
