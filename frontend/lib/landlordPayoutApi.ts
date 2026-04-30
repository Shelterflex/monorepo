/**
 * Landlord Payout Schedule API Client
 */

import { apiGet, withQuery } from "./apiClient";

export type PayoutStatus =
  | "scheduled" | "processing" | "completed" | "delayed" | "failed" | "on_hold";
export type PayoutChannel = "bank_transfer" | "mobile_money" | "crypto_wallet" | "check";
export type PayoutGrouping = "weekly" | "monthly";
export type DelayReason =
  | "bank_processing" | "dispute_hold" | "kyc_incomplete" | "insufficient_funds"
  | "compliance_review" | "system_error" | "weekend_holiday";
export type DeductionType =
  | "platform_fee" | "tax_withholding" | "insurance_premium" | "maintenance_reserve"
  | "late_penalty" | "dispute_deduction" | "other";

export interface Deduction {
  type: DeductionType;
  label: string;
  amount: number;
}

export interface LandlordPayout {
  id: string;
  landlordId: string;
  propertyId: string;
  propertyName: string;
  scheduledDate: string;
  completedDate: string | null;
  grossAmount: number;
  deductions: Deduction[];
  netAmount: number;
  currency: string;
  status: PayoutStatus;
  channel: PayoutChannel;
  delayReasons: DelayReason[];
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayoutPeriod {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  grossTotal: number;
  deductionsTotal: number;
  netTotal: number;
  payoutCount: number;
  delayedCount: number;
  payouts: LandlordPayout[];
}

export interface PayoutScheduleSummary {
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalPayouts: number;
  delayedPayouts: number;
  onHoldPayouts: number;
  currency: string;
}

export interface ScheduleParams {
  propertyId?: string;
  status?: PayoutStatus;
  channel?: PayoutChannel;
  grouping?: PayoutGrouping;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface ScheduleResponse {
  success: boolean;
  data: { periods: PayoutPeriod[]; summary: PayoutScheduleSummary };
}

export interface PayoutListResponse {
  success: boolean;
  data: LandlordPayout[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface PayoutDetailResponse {
  success: boolean;
  data: LandlordPayout;
}

export async function getPayoutSchedule(params?: ScheduleParams): Promise<ScheduleResponse> {
  const query: Record<string, string | number | undefined> = {};
  if (params?.propertyId) query.propertyId = params.propertyId;
  if (params?.status) query.status = params.status;
  if (params?.channel) query.channel = params.channel;
  if (params?.grouping) query.grouping = params.grouping;
  if (params?.from) query.from = params.from;
  if (params?.to) query.to = params.to;
  return apiGet<ScheduleResponse>(withQuery("/api/landlord/payout-schedule", query));
}

export async function listPayouts(params?: ScheduleParams): Promise<PayoutListResponse> {
  const query: Record<string, string | number | undefined> = {};
  if (params?.propertyId) query.propertyId = params.propertyId;
  if (params?.status) query.status = params.status;
  if (params?.channel) query.channel = params.channel;
  if (params?.from) query.from = params.from;
  if (params?.to) query.to = params.to;
  if (params?.page) query.page = params.page;
  if (params?.pageSize) query.pageSize = params.pageSize;
  return apiGet<PayoutListResponse>(withQuery("/api/landlord/payout-schedule/payouts", query));
}

export async function getPayoutDetail(payoutId: string): Promise<PayoutDetailResponse> {
  return apiGet<PayoutDetailResponse>(`/api/landlord/payout-schedule/${payoutId}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export const DELAY_REASON_LABELS: Record<DelayReason, string> = {
  bank_processing: "Bank Processing Delay",
  dispute_hold: "Dispute Hold",
  kyc_incomplete: "KYC Incomplete",
  insufficient_funds: "Insufficient Funds",
  compliance_review: "Compliance Review",
  system_error: "System Error",
  weekend_holiday: "Weekend/Holiday",
};

export const DEDUCTION_TYPE_LABELS: Record<DeductionType, string> = {
  platform_fee: "Platform Fee",
  tax_withholding: "Tax Withholding",
  insurance_premium: "Insurance Premium",
  maintenance_reserve: "Maintenance Reserve",
  late_penalty: "Late Penalty",
  dispute_deduction: "Dispute Deduction",
  other: "Other",
};

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  scheduled: "Scheduled",
  processing: "Processing",
  completed: "Completed",
  delayed: "Delayed",
  failed: "Failed",
  on_hold: "On Hold",
};

export const PAYOUT_CHANNEL_LABELS: Record<PayoutChannel, string> = {
  bank_transfer: "Bank Transfer",
  mobile_money: "Mobile Money",
  crypto_wallet: "Crypto Wallet",
  check: "Check",
};

export function formatCurrency(amount: number, currency: string = "NGN"): string {
  if (currency === "NGN") return `₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (currency === "USDC") return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPeriodLabel(label: string): string {
  const match = label.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(match[2]) - 1]} ${match[1]}`;
  }
  const weekMatch = label.match(/^(\d{4})-W(\d{2})$/);
  if (weekMatch) return `Week ${parseInt(weekMatch[2])}, ${weekMatch[1]}`;
  return label;
}
