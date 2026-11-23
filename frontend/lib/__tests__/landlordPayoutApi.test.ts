import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apiClient")>()),
  apiGet: vi.fn(),
}));

import { apiGet } from "../apiClient";
import {
  formatCurrency,
  formatPeriodLabel,
  getPayoutDetail,
  getPayoutSchedule,
  listPayouts,
} from "../landlordPayoutApi";

const getMock = vi.mocked(apiGet);

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue({} as never);
});

describe("getPayoutSchedule", () => {
  it("GETs the schedule without a query when no params are given", async () => {
    await getPayoutSchedule();
    expect(getMock).toHaveBeenCalledWith("/api/landlord/payout-schedule");
  });

  it("sends only the schedule filters it knows about", async () => {
    await getPayoutSchedule({
      propertyId: "p-1",
      status: "delayed",
      channel: "bank_transfer",
      grouping: "monthly",
      from: "2026-01-01",
      to: "2026-03-31",
      page: 2,
    });

    const url = getMock.mock.calls[0][0] as string;
    const query = new URLSearchParams(url.split("?")[1]);
    expect(url.startsWith("/api/landlord/payout-schedule?")).toBe(true);
    expect(Object.fromEntries(query)).toEqual({
      propertyId: "p-1",
      status: "delayed",
      channel: "bank_transfer",
      grouping: "monthly",
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("propagates request failures", async () => {
    getMock.mockRejectedValueOnce(new Error("403"));
    await expect(getPayoutSchedule()).rejects.toThrow("403");
  });
});

describe("listPayouts", () => {
  it("GETs the payouts list with paging parameters", async () => {
    await listPayouts({ status: "completed", page: 2, pageSize: 10 });

    const url = getMock.mock.calls[0][0] as string;
    expect(url.startsWith("/api/landlord/payout-schedule/payouts?")).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(url.split("?")[1]))).toEqual({
      status: "completed",
      page: "2",
      pageSize: "10",
    });
  });

  it("omits the query string when no filters are given", async () => {
    await listPayouts();
    expect(getMock).toHaveBeenCalledWith("/api/landlord/payout-schedule/payouts");
  });
});

describe("getPayoutDetail", () => {
  it("GETs a single payout by id", async () => {
    getMock.mockResolvedValueOnce({ success: true, data: { id: "po-9" } } as never);

    await expect(getPayoutDetail("po-9")).resolves.toEqual({ success: true, data: { id: "po-9" } });
    expect(getMock).toHaveBeenCalledWith("/api/landlord/payout-schedule/po-9");
  });

  it("propagates not-found failures", async () => {
    getMock.mockRejectedValueOnce(new Error("Not found"));
    await expect(getPayoutDetail("missing")).rejects.toThrow("Not found");
  });
});

describe("formatPeriodLabel", () => {
  it("turns a month key into a short month and year", () => {
    expect(formatPeriodLabel("2026-03")).toBe("Mar 2026");
  });

  it("turns an ISO week key into a week number", () => {
    expect(formatPeriodLabel("2026-W05")).toBe("Week 5, 2026");
  });

  it("returns anything else unchanged", () => {
    expect(formatPeriodLabel("Q1")).toBe("Q1");
  });
});

describe("formatCurrency", () => {
  it("formats NGN through the shared money formatter", () => {
    expect(formatCurrency(1500, "NGN")).toContain("1,500");
  });

  it("prefixes other currency codes with two decimal places", () => {
    expect(formatCurrency(1234.5, "EUR")).toMatch(/^EUR 1[,.]?234[.,]50$/);
  });
});
