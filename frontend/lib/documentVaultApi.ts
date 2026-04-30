/**
 * Document Vault API Client
 * Handles tenant document vault operations
 */

import { apiGet, apiPost, apiPatch, apiDelete, withQuery } from "./apiClient";

// ── Types ────────────────────────────────────────────────────────────────────

export type DocumentCategory =
  | "identification"
  | "receipt"
  | "agreement"
  | "insurance"
  | "utility"
  | "other";

export type DocumentStatus =
  | "active"
  | "expired"
  | "expiring_soon"
  | "pending_review"
  | "rejected";

export type SupportedFileFormat =
  | "pdf"
  | "jpg"
  | "jpeg"
  | "png"
  | "webp"
  | "svg"
  | "doc"
  | "docx";

export interface TenantDocument {
  id: string;
  userId: string;
  fileName: string;
  fileFormat: SupportedFileFormat;
  fileSizeBytes: number;
  storageKey: string;
  category: DocumentCategory;
  tags: string[];
  status: DocumentStatus;
  expiresAt: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentPreview {
  documentId: string;
  fileName: string;
  fileFormat: SupportedFileFormat;
  fileSizeBytes?: number;
  previewAvailable: boolean;
  storageKey?: string;
  message?: string;
}

export interface PaginationInfo {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ListDocumentsResponse {
  success: boolean;
  data: TenantDocument[];
  pagination: PaginationInfo;
}

export interface GetDocumentResponse {
  success: boolean;
  data: TenantDocument;
}

export interface PreviewDocumentResponse {
  success: boolean;
  data: DocumentPreview;
}

export interface CreateDocumentRequest {
  fileName: string;
  fileFormat: SupportedFileFormat;
  fileSizeBytes: number;
  storageKey: string;
  category: DocumentCategory;
  tags?: string[];
  expiresAt?: string;
  description?: string;
}

export interface UpdateDocumentRequest {
  category?: DocumentCategory;
  tags?: string[];
  expiresAt?: string | null;
  description?: string | null;
}

export interface ListDocumentsParams {
  category?: DocumentCategory;
  status?: DocumentStatus;
  tags?: string[];
  search?: string;
  page?: number;
  pageSize?: number;
}

// ── API Functions ────────────────────────────────────────────────────────────

export async function listDocuments(
  params?: ListDocumentsParams,
): Promise<ListDocumentsResponse> {
  const query: Record<string, string | number | undefined> = {};
  if (params?.category) query.category = params.category;
  if (params?.status) query.status = params.status;
  if (params?.tags && params.tags.length > 0) query.tags = params.tags.join(",");
  if (params?.search) query.search = params.search;
  if (params?.page) query.page = params.page;
  if (params?.pageSize) query.pageSize = params.pageSize;

  const path = withQuery("/api/tenant/vault", query);
  return apiGet<ListDocumentsResponse>(path);
}

export async function getDocument(
  documentId: string,
): Promise<GetDocumentResponse> {
  return apiGet<GetDocumentResponse>(`/api/tenant/vault/${documentId}`);
}

export async function previewDocument(
  documentId: string,
): Promise<PreviewDocumentResponse> {
  return apiGet<PreviewDocumentResponse>(
    `/api/tenant/vault/${documentId}/preview`,
  );
}

export async function createDocument(
  data: CreateDocumentRequest,
): Promise<GetDocumentResponse> {
  return apiPost<GetDocumentResponse>("/api/tenant/vault", data);
}

export async function updateDocument(
  documentId: string,
  data: UpdateDocumentRequest,
): Promise<GetDocumentResponse> {
  return apiPatch<GetDocumentResponse>(`/api/tenant/vault/${documentId}`, data);
}

export async function deleteDocument(
  documentId: string,
): Promise<{ success: boolean }> {
  return apiDelete<{ success: boolean }>(`/api/tenant/vault/${documentId}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export const PREVIEWABLE_FORMATS: SupportedFileFormat[] = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "svg",
];

export function isPreviewable(format: SupportedFileFormat): boolean {
  return PREVIEWABLE_FORMATS.includes(format);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getExpirationInfo(expiresAt: string | null): {
  label: string;
  daysUntilExpiry: number | null;
  isExpired: boolean;
  isExpiringSoon: boolean;
} {
  if (!expiresAt) {
    return { label: "No expiration", daysUntilExpiry: null, isExpired: false, isExpiringSoon: false };
  }
  const now = new Date();
  const expiry = new Date(expiresAt);
  const diffMs = expiry.getTime() - now.getTime();
  const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const isExpired = daysUntilExpiry < 0;
  const isExpiringSoon = !isExpired && daysUntilExpiry <= 30;

  let label: string;
  if (isExpired) {
    label = `Expired ${Math.abs(daysUntilExpiry)}d ago`;
  } else if (isExpiringSoon) {
    label = `Expires in ${daysUntilExpiry}d`;
  } else {
    label = `Expires ${expiry.toLocaleDateString()}`;
  }

  return { label, daysUntilExpiry, isExpired, isExpiringSoon };
}

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  identification: "Identification",
  receipt: "Receipt",
  agreement: "Agreement",
  insurance: "Insurance",
  utility: "Utility",
  other: "Other",
};

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  active: "Active",
  expired: "Expired",
  expiring_soon: "Expiring Soon",
  pending_review: "Pending Review",
  rejected: "Rejected",
};
