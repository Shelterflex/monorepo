import { apiFetch } from "./api";
import { apiGet, apiPatch, apiPost } from "./apiClient";
import type { PropertyAmenity, PropertyType } from "./amenities";

export type LandlordPropertyStatus =
  | "pending_review"
  | "approved"
  | "rented"
  | "deactivated"
  | "pending"
  | "active"
  | "inactive";

export interface LandlordPropertyRecord {
  id: string;
  landlordId: string;
  title: string;
  address: string;
  city?: string;
  area?: string;
  propertyType?: PropertyType;
  bedrooms: number;
  bathrooms: number;
  sqm?: number;
  annualRentNgn: number;
  negotiatedLandlordRateNgn?: number;
  outrightPriceNgn?: number;
  installmentBasePriceNgn?: number;
  description?: string;
  amenities: PropertyAmenity[];
  photos: string[];
  primaryPhotoIndex: number;
  videoUrl?: string;
  listingId?: string;
  status: LandlordPropertyStatus;
  views: number;
  inquiries: number;
  createdAt: string;
  updatedAt: string;
}

export interface LandlordPropertiesListResponse {
  properties: LandlordPropertyRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PropertyListingPayload {
  title: string;
  address: string;
  city?: string;
  area?: string;
  propertyType?: PropertyType;
  bedrooms: number;
  bathrooms: number;
  sqm?: number;
  negotiatedLandlordRateNgn: number;
  outrightPriceNgn: number;
  installmentBasePriceNgn: number;
  description?: string;
  amenities: PropertyAmenity[];
  photos: string[];
  primaryPhotoIndex?: number;
  photoOrder?: string[];
  videoUrl?: string;
}

export interface PhotoPresignResponse {
  strategy: string;
  uploadUrl: string;
  method: string;
  fieldName: string;
  maxFiles: number;
  expiresAt: string;
}

export interface UploadedPhoto {
  id: string;
  url: string;
  preview: string;
  file?: File;
}

export interface UploadedPropertyPhoto {
  id: string;
  url: string;
  orderIndex?: number;
  isFeatured?: boolean;
}

export interface UploadPropertyPhotosResponse {
  photos: UploadedPropertyPhoto[];
}

export async function uploadPropertyPhotos(
  propertyId: string,
  files: File[],
): Promise<UploadPropertyPhotosResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append("photos", file));

  return apiFetch<UploadPropertyPhotosResponse>(
    `/properties/${propertyId}/photos`,
    {
      method: "POST",
      body: formData,
    },
  );
}

export async function deletePropertyPhoto(
  propertyId: string,
  photoId: string,
): Promise<void> {
  return apiFetch<void>(`/properties/${propertyId}/photos/${photoId}`, {
    method: "DELETE",
  });
}

export async function reorderPropertyPhotos(
  propertyId: string,
  photoId: string,
  newOrderIndex: number,
): Promise<UploadPropertyPhotosResponse> {
  return apiFetch<UploadPropertyPhotosResponse>(
    `/properties/${propertyId}/photos/order`,
    {
      method: "PATCH",
      body: JSON.stringify({ photoId, newOrderIndex }),
    },
  );
}

export async function setPropertyPhotoPrimary(
  propertyId: string,
  photoId: string,
): Promise<UploadedPropertyPhoto> {
  return apiFetch<UploadedPropertyPhoto>(
    `/properties/${propertyId}/photos/${photoId}/primary`,
    {
      method: "PATCH",
    },
  );
}

export async function listLandlordProperties(params?: {
  status?: string;
  query?: string;
  page?: number;
}): Promise<LandlordPropertiesListResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.query) qs.set("query", params.query);
  if (params?.page) qs.set("page", String(params.page));
  const query = qs.toString();
  return apiGet<LandlordPropertiesListResponse>(
    `/api/landlord/properties${query ? `?${query}` : ""}`,
  );
}

export async function getLandlordProperty(
  id: string,
): Promise<LandlordPropertyRecord> {
  return apiGet<LandlordPropertyRecord>(`/api/landlord/properties/${id}`);
}

export async function createLandlordProperty(
  payload: PropertyListingPayload,
): Promise<LandlordPropertyRecord> {
  return apiPost<LandlordPropertyRecord>("/api/landlord/properties", payload);
}

export async function updateLandlordProperty(
  id: string,
  payload: Partial<PropertyListingPayload>,
): Promise<LandlordPropertyRecord> {
  return apiPatch<LandlordPropertyRecord>(
    `/api/landlord/properties/${id}`,
    payload,
  );
}

export async function deactivateLandlordProperty(
  id: string,
): Promise<LandlordPropertyRecord> {
  return apiPatch<LandlordPropertyRecord>(
    `/api/landlord/properties/${id}/deactivate`,
    {},
  );
}

export async function relistLandlordProperty(
  id: string,
): Promise<LandlordPropertyRecord> {
  return apiPatch<LandlordPropertyRecord>(
    `/api/landlord/properties/${id}/relist`,
    {},
  );
}

export async function getPhotoPresign(
  propertyId: string,
): Promise<PhotoPresignResponse> {
  return apiPost<PhotoPresignResponse>(
    `/api/properties/${propertyId}/photos/presign`,
    {},
  );
}

export async function uploadPropertyPhotosBatch(
  propertyId: string,
  files: File[],
): Promise<{
  results: Array<{ success: boolean; photo: { url: string; id: string } }>;
}> {
  const formData = new FormData();
  files.forEach((file) => formData.append("photos", file));

  return apiFetch(`/api/properties/${propertyId}/photos/batch`, {
    method: "POST",
    body: formData,
  });
}

export async function deleteLandlordProperty(id: string): Promise<void> {
  return apiFetch<void>(`/api/landlord/properties/${id}`, {
    method: "DELETE",
  });
}

export interface LandlordApplicationDocument {
  id: string;
  name: string;
  type: string;
  status: "verified" | "pending" | "rejected";
  url: string;
}

export interface LandlordApplicationRecord {
  id: string;
  listingId: string;
  tenantId: string;
  landlordId: string;
  status: "pending" | "under_review" | "approved" | "rejected" | "withdrawn";
  coverNote?: string;
  preferredStartDate: string;
  paymentPlan: string;
  appliedAt: string;
  reviewedAt?: string;
  reviewerNotes?: string;
  name?: string;
  email?: string;
  phone?: string;
  applicationDate?: string;
  employmentStatus?: string;
  incomeBand?: string;
  ratingCardScore?: number;
  ratingCardLink?: string;
  documents?: LandlordApplicationDocument[];
  incomeVerificationStatus?: "verified" | "pending" | "rejected";
  propertyId?: string;
}

export interface LandlordApplicationsListResponse {
  applications: LandlordApplicationRecord[];
  total: number;
}

export async function listPropertyApplications(
  listingId: string,
): Promise<LandlordApplicationsListResponse> {
  return apiGet<LandlordApplicationsListResponse>(
    `/api/v1/listings/${listingId}/applications`,
  );
}

export async function reviewPropertyApplication(
  applicationId: string,
  decision: "approve" | "reject",
  notes?: string,
): Promise<LandlordApplicationRecord> {
  return apiPost<LandlordApplicationRecord>(
    `/api/applications/${applicationId}/review`,
    { decision, notes },
  );
}

export const MIN_OUTRIGHT_MARGIN_PERCENT = 0.05;

export function computeMarginPreview(
  negotiated: number,
  outright: number,
  installmentBase: number,
) {
  const outrightMargin =
    negotiated > 0 ? (outright - negotiated) / negotiated : 0;
  const installmentMargin =
    negotiated > 0 ? (installmentBase - negotiated) / negotiated : 0;
  return {
    outrightMarginPercent: outrightMargin * 100,
    installmentMarginPercent: installmentMargin * 100,
    belowRecommended: outrightMargin < MIN_OUTRIGHT_MARGIN_PERCENT,
    orderInvalid: outright > installmentBase,
  };
}

export interface LandlordDashboardStats {
  totalProperties: number;
  activeListings: number;
  totalViews: number;
  monthlyRevenueNgn: number;
}

export async function getLandlordDashboardStats(): Promise<LandlordDashboardStats> {
  return apiGet<LandlordDashboardStats>("/api/landlord/dashboard/stats");
}
