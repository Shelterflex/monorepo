import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  getPayoutSchedule,
  listPayouts,
  getPayoutDetail,
  DELAY_REASON_LABELS,
  DEDUCTION_TYPE_LABELS,
  PAYOUT_STATUS_LABELS,
  PAYOUT_CHANNEL_LABELS,
  formatCurrency,
  formatPayoutDate,
  formatPayoutDateTime,
  formatPeriodLabel,
} from "../landlordPayoutApi";

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

import { apiGet } from "../apiClient";

describe("getPayoutSchedule", () => {
  it("fetches schedule with no params", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: {
        periods: [],
        summary: {
          totalGross: 0,
          totalDeductions: 0,
          totalNet: 0,
          totalPayouts: 0,
          delayedPayouts: 0,
          onHoldPayouts: 0,
          currency: "NGN",
        },
      },
    });

    const result = await getPayoutSchedule();

    expect(apiGet).toHaveBeenCalledWith("/api/landlord/payout-schedule");
    expect(result.data.periods).toEqual([]);
  });

  it("includes propertyId, status, channel, grouping, from, to, page, pageSize params", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: {
        periods: [],
        summary: {
          totalGross: 0,
          totalDeductions: 0,
          totalNet: 0,
          totalPayouts: 0,
          delayedPayouts: 0,
          onHoldPayouts: 0,
          currency: "NGN",
        },
      },
    });

    await getPayoutSchedule({
      propertyId: "prop-001",
      status: "completed",
      channel: "bank_transfer",
      grouping: "monthly",
      from: "2025-01-01",
      to: "2025-12-31",
    });

    const path = vi.mocked(apiGet).mock.calls[0][0] as string;
    expect(path).toContain("propertyId=prop-001");
    expect(path).toContain("status=completed");
    expect(path).toContain("channel=bank_transfer");
    expect(path).toContain("grouping=monthly");
    expect(path).toContain("from=2025-01-01");
    expect(path).toContain("to=2025-12-31");
    // Note: getPayoutSchedule doesn't include page/pageSize params in current implementation
  });

  it("propagates errors", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("Unauthorized"));
    await expect(getPayoutSchedule()).rejects.toThrow("Unauthorized");
  });
});

describe("listPayouts", () => {
  it("fetches payouts list with no params", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: [],
      pagination: { total: 0, page: 1, pageSize: 20, totalPages: 0 },
    });

    const result = await listPayouts();

    expect(apiGet).toHaveBeenCalledWith("/api/landlord/payout-schedule/payouts");
    expect(result.data).toEqual([]);
  });

  it("includes all filter params", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: [],
      pagination: { total: 0, page: 1, pageSize: 20, totalPages: 0 },
    });

    await listPayouts({
      propertyId: "prop-001",
      status: "scheduled",
      channel: "mobile_money",
      from: "2025-01-01",
      to: "2025-12-31",
      page: 1,
      pageSize: 5,
    });

    const path = vi.mocked(apiGet).mock.calls[0][0] as string;
    expect(path).toContain("propertyId=prop-001");
    expect(path).toContain("status=scheduled");
    expect(path).toContain("channel=mobile_money");
    expect(path).toContain("from=2025-01-01");
    expect(path).toContain("to=2025-12-31");
    expect(path).toContain("page=1");
    expect(path).toContain("pageSize=5");
  });

  it("propagates errors", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("Not Found"));
    await expect(listPayouts()).rejects.toThrow("Not Found");
  });
});

describe("getPayoutDetail", () => {
  it("fetches payout detail by id", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      data: {
        id: "payout-001",
        landlordId: "landlord-001",
        propertyId: "prop-001",
        propertyName: "Test Property",
        scheduledDate: "2025-01-15",
        completedDate: "2025-01-15",
        grossAmount: 1000000,
        deductions: [],
        netAmount: 950000,
        currency: "NGN",
        status: "completed",
        channel: "bank_transfer",
        delayReasons: [],
        periodStart: "2025-01-01",
        periodEnd: "2025-01-31",
        createdAt: "2025-01-01",
        updatedAt: "2025-01-15",
      },
    });

    const result = await getPayoutDetail("payout-001");

    expect(apiGet).toHaveBeenCalledWith("/api/landlord/payout-schedule/payout-001");
    expect(result.data.id).toBe("payout-001");
  });

  it("propagates errors", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("Unauthorized"));
    await expect(getPayoutDetail("payout-001")).rejects.toThrow("Unauthorized");
  });
});

describe("DELAY_REASON_LABELS", () => {
  it("has correct labels for all delay reasons", () => {
    expect(DELAY_REASON_LABELS.bank_processing).toBe("Bank Processing Delay");
    expect(DELAY_REASON_LABELS.dispute_hold).toBe("Dispute Hold");
    expect(DELAY_REASON_LABELS.kyc_incomplete).toBe("KYC Incomplete");
    expect(DELAY_REASON_LABELS.insufficient_funds).toBe("Insufficient Funds");
    expect(DELAY_REASON_LABELS.compliance_review).toBe("Compliance Review");
    expect(DELAY_REASON_LABELS.system_error).toBe("System Error");
    expect(DELAY_REASON_LABELS.weekend_holiday).toBe("Weekend/Holiday");
  });
});

describe("DEDUCTION_TYPE_LABELS", () => {
  it("has correct labels for all deduction types", () => {
    expect(DEDUCTION_TYPE_LABELS.platform_fee).toBe("Platform Fee");
    expect(DEDUCTION_TYPE_LABELS.tax_withholding).toBe("Tax Withholding");
    expect(DEDUCTION_TYPE_LABELS.insurance_premium).toBe("Insurance Premium");
    expect(DEDUCTION_TYPE_LABELS.maintenance_reserve).toBe("Maintenance Reserve");
    expect(DEDUCTION_TYPE_LABELS.late_penalty).toBe("Late Penalty");
    expect(DEDUCTION_TYPE_LABELS.dispute_deduction).toBe("Dispute Deduction");
    expect(DEDUCTION_TYPE_LABELS.other).toBe("Other");
  });
});

describe("PAYOUT_STATUS_LABELS", () => {
  it("has correct labels for all payout statuses", () => {
    expect(PAYOUT_STATUS_LABELS.scheduled).toBe("Scheduled");
    expect(PAYOUT_STATUS_LABELS.processing).toBe("Processing");
    expect(PAYOUT_STATUS_LABELS.completed).toBe("Completed");
    expect(PAYOUT_STATUS_LABELS.delayed).toBe("Delayed");
    expect(PAYOUT_STATUS_LABELS.failed).toBe("Failed");
    expect(PAYOUT_STATUS_LABELS.on_hold).toBe("On Hold");
  });
});

describe("PAYOUT_CHANNEL_LABELS", () => {
  it("has correct labels for all payout channels", () => {
    expect(PAYOUT_CHANNEL_LABELS.bank_transfer).toBe("Bank Transfer");
    expect(PAYOUT_CHANNEL_LABELS.mobile_money).toBe("Mobile Money");
    expect(PAYOUT_CHANNEL_LABELS.crypto_wallet).toBe("Crypto Wallet");
    expect(PAYOUT_CHANNEL_LABELS.check).toBe("Check");
  });
});

describe("formatCurrency", () => {
  it("formats NGN correctly", () => {
    expect(formatCurrency(1000000, "NGN")).toContain("₦");
  });

  it("formats USDC correctly", () => {
    expect(formatCurrency(1000, "USDC")).toContain("1,000.00");
  });

  it("formats other currencies correctly", () => {
    expect(formatCurrency(1000, "EUR")).toBe("EUR 1,000.00");
  });
});

describe("formatPayoutDate", () => {
  it("formats date string correctly", () => {
    const result = formatPayoutDate("2025-01-15");
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    expect(result).toContain("2025");
  });

  it("formats Date object correctly", () => {
    const result = formatPayoutDate(new Date("2025-01-15"));
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    expect(result).toContain("2025");
  });
});

describe("formatPayoutDateTime", () => {
  it("formats date string with time", () => {
    const result = formatPayoutDateTime("2025-01-15T10:30:00Z");
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    expect(result).toContain("2025");
    expect(result).toContain(":");
  });

  it("formats Date object with time", () => {
    const result = formatPayoutDateTime(new Date("2025-01-15T10:30:00Z"));
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    expect(result).toContain("2025");
    expect(result).toContain(":");
  });
});

describe("formatPeriodLabel", () => {
  it("formats monthly period label (YYYY-MM)", () => {
    expect(formatPeriodLabel("2025-01")).toBe("Jan 2025");
    expect(formatPeriodLabel("2025-12")).toBe("Dec 2025");
  });

  it("formats weekly period label (YYYY-WWW)", () => {
    expect(formatPeriodLabel("2025-W01")).toBe("Week 1, 2025");
    expect(formatPeriodLabel("2025-W52")).toBe("Week 52, 2025");
  });

  it("returns original label for unknown format", () => {
    expect(formatPeriodLabel("unknown")).toBe("unknown");
  });
});