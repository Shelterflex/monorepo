import { apiGet } from "./apiClient";

export type DataSource = "live" | "mock";

export interface UsersByRole {
  tenant: number;
  landlord: number;
  agent: number;
  admin: number;
}

export interface AnalyticsOverview {
  usersByRole: UsersByRole;
  activeDeals: number;
  revenueMtd: number;
  defaultRate: number;
  period: string;
  dataSource: DataSource;
}

export interface DealFunnel {
  draft: number;
  active: number;
  at_risk: number;
  completed: number;
  defaulted: number;
  dataSource: DataSource;
}

export interface RevenueTimelineItem {
  date: string;
  feeType: string;
  amount: number;
}

export interface RevenueTimelineData {
  series: RevenueTimelineItem[];
  dataSource: DataSource;
}

export interface ListingQualityMetrics {
  inspectionPassRate: number;
  averageListingScore: number;
  whistleblowerReportRate: number;
  dataSource: DataSource;
}

export interface AnalyticsOverviewResponse {
  success: boolean;
  data: AnalyticsOverview;
}

export interface DealFunnelResponse {
  success: boolean;
  data: DealFunnel;
}

export interface RevenueTimelineResponse {
  success: boolean;
  data: RevenueTimelineData;
}

export interface ListingQualityResponse {
  success: boolean;
  data: ListingQualityMetrics;
}

/**
 * Fetch platform analytics overview KPIs
 */
export async function getAnalyticsOverview(): Promise<AnalyticsOverviewResponse> {
  return apiGet<AnalyticsOverviewResponse>("/api/admin/analytics/overview");
}

/**
 * Fetch counts per deal status for the deal funnel
 */
export async function getDealFunnel(): Promise<DealFunnelResponse> {
  return apiGet<DealFunnelResponse>("/api/admin/analytics/deal-funnel");
}

/**
 * Fetch chronological revenue logs by timeframe
 * @param range '7d' | '30d' | '90d'
 */
export async function getRevenueTimeline(range: "7d" | "30d" | "90d" = "30d"): Promise<RevenueTimelineResponse> {
  return apiGet<RevenueTimelineResponse>(`/api/admin/analytics/revenue?range=${range}`);
}

/**
 * Fetch platform listing quality scores and pass rates
 */
export async function getListingQuality(): Promise<ListingQualityResponse> {
  return apiGet<ListingQualityResponse>("/api/admin/analytics/listing-quality");
}
