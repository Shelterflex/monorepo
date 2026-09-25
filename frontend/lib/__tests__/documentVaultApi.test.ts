import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  listDocuments,
  getDocument,
  previewDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  isPreviewable,
  PREVIEWABLE_FORMATS,
  formatFileSize,
  getExpirationInfo,
  CATEGORY_LABELS,
  STATUS_LABELS,
} from "../documentVaultApi";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("../apiClient", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiPatch: vi.fn(),
    apiDelete: vi.fn(),
  };
});

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    apiFetch: vi.fn(),
    apiGet: vi.fn(),
    apiPatch: vi.fn(),
    apiPost: vi.fn(),
  };
});

import { apiGet, apiPost, apiPatch, apiDelete, withQuery } from "../apiClient";

describe("listDocuments", () => {
  it("fetches documents with no params", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: [],
      pagination: { total: 0, page: 1, pageSize: 20, totalPages: 0 },
    });

    const result = await listDocuments();

    expect(apiGet).toHaveBeenCalledWith("/api/tenant/vault");
    expect(result.data).toEqual([]);
  });

  it("includes category, status, tags, search, page, pageSize params", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: [],
      pagination: { total: 0, page: 1, pageSize: 20, totalPages: 0 },
    });

    await listDocuments({
      category: "identification",
      status: "active",
      tags: ["tag1", "tag2"],
      search: "lease",
      page: 2,
      pageSize: 10,
    });

    const path = vi.mocked(apiGet).mock.calls[0][0] as string;
    expect(path).toContain("category=identification");
    expect(path).toContain("status=active");
    // tags are URL-encoded (comma becomes %2C)
    expect(path).toContain("tags=tag1%2Ctag2");
    expect(path).toContain("search=lease");
    expect(path).toContain("page=2");
    expect(path).toContain("pageSize=10");
  });

  it("handles empty tags array", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: [],
      pagination: { total: 0, page: 1, pageSize: 20, totalPages: 0 },
    });

    await listDocuments({ tags: [] });

    const path = vi.mocked(apiGet).mock.calls[0][0] as string;
    expect(path).not.toContain("tags=");
  });

  it("propagates errors", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("Unauthorized"));
    await expect(listDocuments()).rejects.toThrow("Unauthorized");
  });
});

describe("getDocument", () => {
  it("fetches document by id", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: {
        id: "doc-001",
        userId: "user-001",
        fileName: "lease.pdf",
        fileFormat: "pdf",
        fileSizeBytes: 1024000,
        storageKey: "uploads/doc-001",
        category: "agreement",
        tags: [],
        status: "active",
        expiresAt: null,
        description: "Lease agreement",
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
      },
    });

    const result = await getDocument("doc-001");

    expect(apiGet).toHaveBeenCalledWith("/api/tenant/vault/doc-001");
    expect(result.data.id).toBe("doc-001");
  });

  it("propagates errors", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("Not Found"));
    await expect(getDocument("doc-001")).rejects.toThrow("Not Found");
  });
});

describe("previewDocument", () => {
  it("fetches document preview by id", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: {
        documentId: "doc-001",
        fileName: "lease.pdf",
        fileFormat: "pdf",
        fileSizeBytes: 1024000,
        previewAvailable: true,
        storageKey: "uploads/doc-001",
      },
    });

    const result = await previewDocument("doc-001");

    expect(apiGet).toHaveBeenCalledWith("/api/tenant/vault/doc-001/preview");
    expect(result.data.documentId).toBe("doc-001");
    expect(result.data.previewAvailable).toBe(true);
  });

  it("propagates errors", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("Not Found"));
    await expect(previewDocument("doc-001")).rejects.toThrow("Not Found");
  });
});

describe("createDocument", () => {
  it("POSTs document payload", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      success: true,
      data: {
        id: "doc-002",
        userId: "user-001",
        fileName: "id-card.jpg",
        fileFormat: "jpg",
        fileSizeBytes: 512000,
        storageKey: "uploads/doc-002",
        category: "identification",
        tags: ["kyc"],
        status: "active",
        expiresAt: "2026-01-01",
        description: "Government ID",
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
      },
    });

    const payload = {
      fileName: "id-card.jpg",
      fileFormat: "jpg" as const,
      fileSizeBytes: 512000,
      storageKey: "uploads/doc-002",
      category: "identification" as const,
      tags: ["kyc"],
      expiresAt: "2026-01-01",
      description: "Government ID",
    };

    const result = await createDocument(payload);

    expect(apiPost).toHaveBeenCalledWith("/api/tenant/vault", payload);
    expect(result.data.id).toBe("doc-002");
    expect(result.data.category).toBe("identification");
  });

  it("propagates errors", async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error("Validation Error"));
    await expect(
      createDocument({
        fileName: "test.pdf",
        fileFormat: "pdf",
        fileSizeBytes: 1000,
        storageKey: "test",
        category: "other",
      })
    ).rejects.toThrow("Validation Error");
  });
});

describe("updateDocument", () => {
  it("PATCHes document with partial payload", async () => {
    vi.mocked(apiPatch).mockResolvedValue({
      success: true,
      data: {
        id: "doc-001",
        userId: "user-001",
        fileName: "lease.pdf",
        fileFormat: "pdf",
        fileSizeBytes: 1024000,
        storageKey: "uploads/doc-001",
        category: "receipt",
        tags: ["updated"],
        status: "active",
        expiresAt: "2026-01-01",
        description: "Updated description",
        createdAt: "2025-01-01",
        updatedAt: "2025-01-15",
      },
    });

    const result = await updateDocument("doc-001", {
      category: "receipt",
      tags: ["updated"],
      expiresAt: "2026-01-01",
      description: "Updated description",
    });

    expect(apiPatch).toHaveBeenCalledWith("/api/tenant/vault/doc-001", {
      category: "receipt",
      tags: ["updated"],
      expiresAt: "2026-01-01",
      description: "Updated description",
    });
    expect(result.data.category).toBe("receipt");
  });

  it("allows null expiresAt to clear expiration", async () => {
    vi.mocked(apiPatch).mockResolvedValue({
      success: true,
      data: {
        id: "doc-001",
        userId: "user-001",
        fileName: "lease.pdf",
        fileFormat: "pdf",
        fileSizeBytes: 1024000,
        storageKey: "uploads/doc-001",
        category: "agreement",
        tags: [],
        status: "active",
        expiresAt: null,
        description: null,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-15",
      },
    });

    const result = await updateDocument("doc-001", {
      expiresAt: null,
      description: null,
    });

    expect(apiPatch).toHaveBeenCalledWith("/api/tenant/vault/doc-001", {
      expiresAt: null,
      description: null,
    });
    expect(result.data.expiresAt).toBeNull();
  });

  it("propagates errors", async () => {
    vi.mocked(apiPatch).mockRejectedValue(new Error("Not Found"));
    await expect(updateDocument("doc-001", { category: "other" })).rejects.toThrow("Not Found");
  });
});

describe("deleteDocument", () => {
  it("DELETEs document by id", async () => {
    vi.mocked(apiDelete).mockResolvedValue({ success: true });

    await deleteDocument("doc-001");

    expect(apiDelete).toHaveBeenCalledWith("/api/tenant/vault/doc-001");
  });

  it("propagates errors", async () => {
    vi.mocked(apiDelete).mockRejectedValue(new Error("Not Found"));
    await expect(deleteDocument("doc-001")).rejects.toThrow("Not Found");
  });
});

describe("isPreviewable", () => {
  it("returns true for all previewable formats", () => {
    PREVIEWABLE_FORMATS.forEach((format) => {
      expect(isPreviewable(format)).toBe(true);
    });
  });

  it("returns false for non-previewable formats", () => {
    expect(isPreviewable("doc")).toBe(false);
    expect(isPreviewable("docx")).toBe(false);
  });
});

describe("PREVIEWABLE_FORMATS", () => {
  it("contains expected formats", () => {
    expect(PREVIEWABLE_FORMATS).toContain("pdf");
    expect(PREVIEWABLE_FORMATS).toContain("jpg");
    expect(PREVIEWABLE_FORMATS).toContain("jpeg");
    expect(PREVIEWABLE_FORMATS).toContain("png");
    expect(PREVIEWABLE_FORMATS).toContain("webp");
    expect(PREVIEWABLE_FORMATS).toContain("svg");
    expect(PREVIEWABLE_FORMATS).not.toContain("doc");
    expect(PREVIEWABLE_FORMATS).not.toContain("docx");
  });
});

describe("formatFileSize", () => {
  it("formats bytes correctly", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats KB correctly", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("formats MB correctly", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe("2.5 MB");
  });
});

describe("getExpirationInfo", () => {
  const fixedDate = new Date("2025-06-15T00:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns no expiration info when expiresAt is null", () => {
    const result = getExpirationInfo(null);
    expect(result).toEqual({
      label: "No expiration",
      daysUntilExpiry: null,
      isExpired: false,
      isExpiringSoon: false,
    });
  });

  it("returns expired info when date is in the past", () => {
    const result = getExpirationInfo("2025-06-10T00:00:00Z");
    expect(result.isExpired).toBe(true);
    expect(result.daysUntilExpiry).toBeLessThan(0);
    expect(result.label).toContain("Expired");
  });

  it("returns expiring soon info when within 30 days", () => {
    const result = getExpirationInfo("2025-07-10T00:00:00Z");
    expect(result.isExpired).toBe(false);
    expect(result.isExpiringSoon).toBe(true);
    expect(result.daysUntilExpiry).toBeLessThanOrEqual(30);
    expect(result.label).toContain("Expires in");
  });

  it("returns normal expiration info when more than 30 days away", () => {
    const result = getExpirationInfo("2025-08-15T00:00:00Z");
    expect(result.isExpired).toBe(false);
    expect(result.isExpiringSoon).toBe(false);
    expect(result.daysUntilExpiry).toBeGreaterThan(30);
    expect(result.label).toContain("Expires");
  });
});

describe("CATEGORY_LABELS", () => {
  it("has correct labels for all categories", () => {
    expect(CATEGORY_LABELS.identification).toBe("Identification");
    expect(CATEGORY_LABELS.receipt).toBe("Receipt");
    expect(CATEGORY_LABELS.agreement).toBe("Agreement");
    expect(CATEGORY_LABELS.insurance).toBe("Insurance");
    expect(CATEGORY_LABELS.utility).toBe("Utility");
    expect(CATEGORY_LABELS.other).toBe("Other");
  });
});

describe("STATUS_LABELS", () => {
  it("has correct labels for all statuses", () => {
    expect(STATUS_LABELS.active).toBe("Active");
    expect(STATUS_LABELS.expired).toBe("Expired");
    expect(STATUS_LABELS.expiring_soon).toBe("Expiring Soon");
    expect(STATUS_LABELS.pending_review).toBe("Pending Review");
    expect(STATUS_LABELS.rejected).toBe("Rejected");
  });
});