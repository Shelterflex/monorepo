import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTenantApplication,
  getTenantApplication,
  listTenantApplications,
  getPaymentSchedule,
  getPaymentHistory,
  getWalletBalance,
  initiateQuickPay,
  initiateWalletTopUp,
  getMyDisputes,
  createDispute,
  getTenantCurrentLease,
  getTenantLeaseDetails,
  getTenantLeaseDocuments,
} from "../tenantApi";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("../apiClient", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet, apiPost } from "../apiClient";

// ── Application API ─────────────────────────────────────────────────────────

describe("createTenantApplication", () => {
  it("POSTs application data to correct endpoint", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      success: true,
      data: { applicationId: "A-001", status: "pending" },
    });

    const result = await createTenantApplication({
      propertyId: 1,
      annualRent: 1_000_000,
      deposit: 200_000,
      duration: 12,
      hasAgreedToTerms: true,
    });

    expect(apiPost).toHaveBeenCalledWith("/api/tenant/applications", {
      propertyId: 1,
      annualRent: 1_000_000,
      deposit: 200_000,
      duration: 12,
      hasAgreedToTerms: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("getTenantApplication", () => {
  it("fetches application by id", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: { applicationId: "A-002", status: "approved" },
    });

    const result = await getTenantApplication("A-002");
    expect(apiGet).toHaveBeenCalledWith("/api/tenant/applications/A-002");
    expect(result.data.status).toBe("approved");
  });
});

describe("listTenantApplications", () => {
  it("calls endpoint without params", async () => {
    vi.mocked(apiGet).mockResolvedValue({ success: true, data: [] });
    await listTenantApplications();
    expect(apiGet).toHaveBeenCalledWith("/api/tenant/applications");
  });

  it("includes status and limit in query params", async () => {
    vi.mocked(apiGet).mockResolvedValue({ success: true, data: [] });
    await listTenantApplications({ status: "pending", limit: 5 });
    const path = vi.mocked(apiGet).mock.calls[0][0] as string;
    expect(path).toContain("status=pending");
    expect(path).toContain("limit=5");
  });

  it("includes cursor in query params", async () => {
    vi.mocked(apiGet).mockResolvedValue({ success: true, data: [], nextCursor: "abc" });
    await listTenantApplications({ cursor: "abc" });
    const path = vi.mocked(apiGet).mock.calls[0][0] as string;
    expect(path).toContain("cursor=abc");
  });
});

// ── Payment API ─────────────────────────────────────────────────────────────

describe("getPaymentSchedule", () => {
  it("fetches payment schedule", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: { schedule: [], nextPayment: null },
    });

    const result = await getPaymentSchedule();
    expect(apiGet).toHaveBeenCalledWith("/api/v1/tenant/payments/schedule");
    expect(result.data.schedule).toEqual([]);
  });
});

describe("getPaymentHistory", () => {
  it("fetches with default params", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: { payments: [], page: 1, limit: 10, total: 0 },
    });

    await getPaymentHistory();
    expect(apiGet).toHaveBeenCalledWith("/api/v1/tenant/payments");
  });

  it("includes dealId filter", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: { payments: [], page: 1, limit: 10, total: 0 },
    });

    await getPaymentHistory({ dealId: "D-001", page: 2, limit: 5 });
    const path = vi.mocked(apiGet).mock.calls[0][0] as string;
    expect(path).toContain("dealId=D-001");
    expect(path).toContain("page=2");
    expect(path).toContain("limit=5");
  });
});

describe("getWalletBalance", () => {
  it("fetches wallet balance", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: { balance: 500_000, availableNgn: 400_000, heldNgn: 100_000, totalNgn: 500_000, lastTopUp: "2025-01-01", autoPayEnabled: true },
    });

    const result = await getWalletBalance();
    expect(apiGet).toHaveBeenCalledWith("/api/tenant/payments/wallet");
    expect(result.data.balance).toBe(500_000);
  });
});

describe("initiateQuickPay", () => {
  it("POSTs quick pay request", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      success: true,
      data: { paymentId: "P-001", status: "pending", amount: 100_000, method: "wallet", message: "Processing" },
    });

    const result = await initiateQuickPay({
      dealId: "D-001",
      amount: 100_000,
      paymentMethod: "wallet",
    });

    expect(apiPost).toHaveBeenCalledWith("/api/tenant/payments/quick-pay", {
      dealId: "D-001",
      amount: 100_000,
      paymentMethod: "wallet",
    });
    expect(result.data.status).toBe("pending");
  });
});

describe("initiateWalletTopUp", () => {
  it("POSTs wallet top-up request", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      success: true,
      data: { topUpId: "T-001", amount: 200_000, status: "pending", reference: "REF-001" },
    });

    const result = await initiateWalletTopUp({
      amount: 200_000,
      paymentMethod: "card",
    });

    expect(apiPost).toHaveBeenCalledWith("/api/tenant/payments/wallet/topup", {
      amount: 200_000,
      paymentMethod: "card",
    });
    expect(result.data.topUpId).toBe("T-001");
  });
});

// ── Dispute API ─────────────────────────────────────────────────────────────

describe("getMyDisputes", () => {
  it("fetches disputes list", async () => {
    vi.mocked(apiGet).mockResolvedValue({ success: true, data: { disputes: [] } });
    const result = await getMyDisputes();
    expect(apiGet).toHaveBeenCalledWith("/api/tenant/payments/disputes");
    expect(result.data.disputes).toEqual([]);
  });
});

describe("createDispute", () => {
  it("POSTs dispute data", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      success: true,
      data: {
        dispute: {
          id: "DIS-001",
          paymentId: "P-001",
          dealId: "D-001",
          reason: "amount_discrepancy",
          description: "Charged wrong amount",
          status: "pending",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });

    const result = await createDispute({
      paymentId: "P-001",
      dealId: "D-001",
      reason: "amount_discrepancy",
      description: "Charged wrong amount",
    });

    expect(apiPost).toHaveBeenCalledWith("/api/tenant/payments/disputes", {
      paymentId: "P-001",
      dealId: "D-001",
      reason: "amount_discrepancy",
      description: "Charged wrong amount",
    });
    expect(result.data.dispute.id).toBe("DIS-001");
  });
});

// ── Tenant Lease API ────────────────────────────────────────────────────────

describe("getTenantCurrentLease", () => {
  it("fetches current lease", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: {
        dealId: "D-001",
        property: "12 Marina",
        location: "Lagos",
        monthlyPayment: 500_000,
        nextPaymentDate: "2025-07-01",
        leaseEnd: "2026-06-30",
        totalPaid: 3_000_000,
        totalOwed: 6_000_000,
        progress: 50,
        landlord: { name: "Landlord Inc" },
      },
    });

    const result = await getTenantCurrentLease();
    expect(apiGet).toHaveBeenCalledWith("/api/tenant/lease/current");
    expect(result.data.progress).toBe(50);
  });
});

describe("getTenantLeaseDetails", () => {
  it("fetches lease details for a deal", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: {
        dealId: "D-001",
        property: { title: "12 Marina", address: "12 Marina Lagos", beds: 3, baths: 2, sqm: 120 },
        lease: { startDate: "2025-01-01", endDate: "2025-12-31", duration: "12 months", monthlyPayment: 500_000, status: "active" },
        landlord: { name: "Landlord Inc", phone: "+2348012345678", email: "landlord@example.com" },
        paymentProgress: { totalPaid: 1_000_000, totalOwed: 6_000_000, paymentsCompleted: 2, totalPayments: 12 },
      },
    });

    const result = await getTenantLeaseDetails("D-001");
    expect(apiGet).toHaveBeenCalledWith("/api/tenant/deals/D-001/lease");
    expect(result.data.lease.status).toBe("active");
  });
});

describe("getTenantLeaseDocuments", () => {
  it("fetches lease documents", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: [{ id: "DOC-001", name: "Lease Agreement", date: "2025-01-01", type: "pdf", size: "1.2MB", status: "signed" }],
    });

    const result = await getTenantLeaseDocuments("D-001");
    expect(apiGet).toHaveBeenCalledWith("/api/tenant/deals/D-001/documents");
    expect(result.data).toHaveLength(1);
  });
});

describe("error handling", () => {
  it("propagates errors from payment API", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("Forbidden"));
    await expect(getWalletBalance()).rejects.toThrow("Forbidden");
  });

  it("propagates errors from application API", async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error("Bad Request"));
    await expect(
      createTenantApplication({
        propertyId: 1,
        annualRent: 0,
        deposit: 0,
        duration: 0,
        hasAgreedToTerms: false,
      }),
    ).rejects.toThrow("Bad Request");
  });
});
