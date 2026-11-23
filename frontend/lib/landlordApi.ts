import { apiFetch } from "./api";
import { apiPost } from "./api";

export interface LandlordStat {
  label: string;
  value: string;
  icon: string; // Icon name to be mapped in the component
  color: string;
}

export interface LandlordProperty {
  id: number | string;
  title: string;
  location: string;
  price: number;
  beds: number;
  baths: number;
  sqm: number;
  status: "active" | "pending" | "inactive";
  views: number;
  inquiries: number;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
  image?: string;
  tenant?: {
    name: string;
    avatar: string;
  } | null;
}

export interface LandlordDashboardData {
  stats: LandlordStat[];
  properties: LandlordProperty[];
}

export interface OccupancyData {
  date: string;
  rate: number;
}

export interface RevenueData {
  month: string;
  expected: number;
  collected: number;
}

export interface PaymentTrendData {
  date: string;
  onTime: number;
  late: number;
  missed: number;
}

export interface VacancyMetrics {
  averageTimeToFill: number;
  currentVacancyCount: number;
}

export interface LandlordAnalytics {
  occupancyTrend: OccupancyData[];
  revenueBreakdown: RevenueData[];
  paymentTrends: PaymentTrendData[];
  vacancyMetrics: VacancyMetrics;
}

export interface LandlordTenant {
  id: string;
  name: string;
  property: string;
  status: string;
  leaseStart: string;
  leaseEnd: string;
  monthlyPayment: number;
  totalPaid: number;
  verified: boolean;
}

export const landlordApi = {
  getDashboardData: async (): Promise<LandlordDashboardData> => {
    return apiFetch<LandlordDashboardData>("/api/landlord/dashboard");
  },

  getProperties: async (): Promise<LandlordProperty[]> => {
    return apiFetch<LandlordProperty[]>("/api/landlord/properties");
  },

  getProperty: async (id: string | number): Promise<LandlordProperty> => {
    return apiFetch<LandlordProperty>(`/api/landlord/properties/${id}`);
  },

  getTenants: async (): Promise<LandlordTenant[]> => {
    return apiFetch<LandlordTenant[]>("/api/landlord/tenants");
  },

  getApplications: async (): Promise<any[]> => {
    return apiFetch<any[]>("/api/landlord/applications");
  },

  getAnalytics: async (params?: { startDate?: string; endDate?: string; propertyId?: string }): Promise<LandlordAnalytics> => {
    const query = new URLSearchParams(params as any).toString();
    return apiFetch<LandlordAnalytics>(`/api/landlord/analytics?${query}`);
  },

  createProperty: async (payload: unknown): Promise<any> => {
    return apiPost<any>("/api/landlord/properties", payload);
  },
};
