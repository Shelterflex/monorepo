/**
 * Tenant API Client
 * Handles tenant application and payment operations
 */

import { apiGet, apiPost } from "./apiClient";

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

export interface TenantDeal {
  dealId: string;
  leaseName: string;
}

export type PaymentStatus = "paid" | "overdue" | "upcoming" | "processing";

export interface PaymentScheduleItem {
  period: number;
  month: string;
  amount: number;
  dueDate: string;
  status: "paid" | "upcoming" | "pending" | "overdue";
  paidDate?: string;
  isNextDue?: boolean;
}

export interface PaymentScheduleResponse {
  success: boolean;
  data: {
    schedule: PaymentScheduleItem[];
    nextPayment: PaymentScheduleItem | null;
    dealId?: string;
    deals?: TenantDeal[];
  };
}

export interface PaymentHistoryItem {
  id: string;
  dealId: string;
  reference: string;
  amount: number;
  status: PaymentStatus;
  transactionDate: string;
  paidDate?: string;
  dueDate?: string;
  method: string;
  isOverdue?: boolean;
  daysOverdue?: number;
  /**
   * True once this payment's rent-to-own equity has actually landed
   * on-chain (record_equity_payment confirmed), as opposed to merely
   * being marked paid off-chain. Undefined when the backend hasn't
   * surfaced on-chain confirmation for this payment yet.
   */
  confirmedOnChain?: boolean;
}

export interface PaymentHistoryResponse {
  success: boolean;
  data: {
    payments: PaymentHistoryItem[];
    page: number;
    limit: number;
    total: number;
    nextPage?: number;
    deals?: TenantDeal[];
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
  idempotencyKey?: string;
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
  dealId: string;
  reason: DisputeReason;
  description: string;
  status: "pending" | "under_review" | "resolved" | "rejected";
  resolution?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDisputeRequest {
  paymentId: string;
  dealId: string;
  reason: DisputeReason;
  description: string;
  evidenceKeys?: string[];
}

export interface GetMyDisputesResponse {
  success: boolean;
  data: { disputes: PaymentDispute[] };
}

export interface CreateDisputeResponse {
  success: boolean;
  data: { dispute: PaymentDispute };
}

export async function getMyDisputes(): Promise<GetMyDisputesResponse> {
  return apiGet<GetMyDisputesResponse>("/api/v1/tenant/payments/disputes");
}

export async function createDispute(
  data: CreateDisputeRequest,
): Promise<CreateDisputeResponse> {
  return apiPost<CreateDisputeResponse>(
    "/api/v1/tenant/payments/disputes",
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
  return apiGet<PaymentScheduleResponse>("/api/v1/tenant/payments/schedule");
}

export async function getPaymentHistory(params?: {
  limit?: number;
  page?: number;
  dealId?: string;
}): Promise<PaymentHistoryResponse> {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", params.limit.toString());
  if (params?.page) query.set("page", params.page.toString());
  if (params?.dealId) query.set("dealId", params.dealId);

  const path = `/api/v1/tenant/payments${query.toString() ? `?${query.toString()}` : ""}`;
  return apiGet<PaymentHistoryResponse>(path);
}

export async function getWalletBalance(): Promise<WalletBalanceResponse> {
  return apiGet<WalletBalanceResponse>("/api/v1/tenant/payments/wallet");
}

export async function initiateQuickPay(
  data: QuickPayRequest,
): Promise<QuickPayResponse> {
  return apiPost<QuickPayResponse>("/api/v1/tenant/payments/quick-pay", data);
}

export async function initiateWalletTopUp(
  data: WalletTopUpRequest,
): Promise<WalletTopUpResponse> {
  return apiPost<WalletTopUpResponse>(
    "/api/v1/tenant/payments/wallet/topup",
    data,
  );
}

// ── Tenant Lease API Functions ─────────────────────────────────────────────

export interface TenantLeaseDetails {
  dealId: string;
  property: {
    title: string;
    address: string;
    beds: number;
    baths: number;
    sqm: number;
  };
  lease: {
    startDate: string;
    endDate: string;
    duration: string;
    monthlyPayment: number;
    status: string;
  };
  landlord: {
    name: string;
    company?: string;
    phone: string;
    email: string;
  };
  paymentProgress: {
    totalPaid: number;
    totalOwed: number;
    paymentsCompleted: number;
    totalPayments: number;
  };
}

export interface TenantLeaseDocument {
  id: string;
  name: string;
  date: string;
  type: string;
  size: string;
  status: string;
  url?: string;
}

export interface TenantCurrentLease {
  dealId: string;
  property: string;
  location: string;
  monthlyPayment: number;
  nextPaymentDate: string;
  leaseEnd: string;
  totalPaid: number;
  totalOwed: number;
  progress: number;
  landlord: { name: string };
}

export async function getTenantCurrentLease(): Promise<{
  success: boolean;
  data: TenantCurrentLease;
}> {
  return apiGet<{ success: boolean; data: TenantCurrentLease }>(
    "/api/tenant/lease/current",
  );
}

export async function getTenantLeaseDetails(
  dealId: string,
): Promise<{ success: boolean; data: TenantLeaseDetails }> {
  return apiGet<{ success: boolean; data: TenantLeaseDetails }>(
    `/api/tenant/deals/${dealId}/lease`,
  );
}

export async function getTenantLeaseDocuments(
  dealId: string,
): Promise<{ success: boolean; data: TenantLeaseDocument[] }> {
  return apiGet<{ success: boolean; data: TenantLeaseDocument[] }>(
    `/api/tenant/deals/${dealId}/documents`,
  );
}
