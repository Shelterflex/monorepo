import { describe, it, expect } from "vitest";
import {
  groupPayoutsByProperty,
  groupPayoutsIntoPeriods,
  isUpcoming,
  monthlyPeriodFor,
  summarizePayouts,
  weeklyPeriodFor,
  withNetAmount,
} from "./landlordPayoutScheduleGrouping.js";
import type { LandlordPayout } from "../schemas/landlordPayoutSchedule.js";

function payout(overrides: Partial<LandlordPayout> = {}): LandlordPayout {
  return {
    id: "payout-1",
    landlordId: "landlord-1",
    propertyId: "property-1",
    propertyName: "Lekki Flat",
    scheduledDate: "2026-01-15T09:00:00.000Z",
    completedDate: null,
    grossAmount: 100000,
    deductions: [],
    netAmount: 100000,
    currency: "NGN",
    status: "scheduled",
    channel: "bank_transfer",
    delayReasons: [],
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: "2026-01-31T23:59:59.999Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("payout net amount (#2055)", () => {
  it("is gross minus the sum of fees for every payout", () => {
    const withFees = withNetAmount(
      payout({
        grossAmount: 100000,
        deductions: [
          { type: "platform_fee", label: "Platform fee", amount: 2500.5 },
          { type: "late_penalty", label: "Late penalty", amount: 499.5 },
        ],
      }),
    );
    expect(withFees.netAmount).toBe(97000);
  });

  it("ignores a stored net that disagrees with gross minus fees", () => {
    const wrong = payout({
      grossAmount: 50000,
      netAmount: 999999,
      deductions: [{ type: "platform_fee", label: "Platform fee", amount: 1000 }],
    });
    expect(withNetAmount(wrong).netAmount).toBe(49000);
  });

  it("keeps net equal to gross when there are no fees", () => {
    expect(withNetAmount(payout({ grossAmount: 12345.67 })).netAmount).toBe(12345.67);
  });
});

describe("upcoming payouts", () => {
  it.each([
    ["scheduled", true],
    ["processing", true],
    ["delayed", true],
    ["on_hold", true],
    ["completed", false],
    ["failed", false],
  ] as const)("treats %s as upcoming=%s", (status, expected) => {
    expect(isUpcoming(payout({ status }))).toBe(expected);
  });
});

describe("period bounds (UTC)", () => {
  it("groups by calendar month and keeps the last day in its month", () => {
    const bounds = monthlyPeriodFor(new Date("2026-02-28T23:30:00.000Z"));
    expect(bounds.label).toBe("2026-02");
    expect(bounds.end.toISOString()).toBe("2026-02-28T23:59:59.999Z");
  });

  it("uses ISO weeks that start on Monday", () => {
    // 2025-12-29 is a Monday in ISO week 1 of 2026.
    expect(weeklyPeriodFor(new Date("2025-12-29T10:00:00.000Z")).label).toBe("2026-W01");
    // 2026 starts on a Thursday, so it has 53 ISO weeks.
    expect(weeklyPeriodFor(new Date("2026-12-31T12:00:00.000Z")).label).toBe("2026-W53");
  });
});

describe("grouping and summaries", () => {
  it("groups by month, oldest first, with per-period totals", () => {
    const periods = groupPayoutsIntoPeriods(
      [
        payout({ id: "a", scheduledDate: "2026-02-03T09:00:00.000Z", grossAmount: 10000 }),
        payout({ id: "b", scheduledDate: "2026-01-20T09:00:00.000Z", grossAmount: 20000 }),
        payout({
          id: "c",
          scheduledDate: "2026-01-25T09:00:00.000Z",
          grossAmount: 30000,
          deductions: [{ type: "platform_fee", label: "Platform fee", amount: 3000 }],
          status: "delayed",
        }),
      ],
      "monthly",
    );

    expect(periods.map((p) => p.periodLabel)).toEqual(["2026-01", "2026-02"]);
    expect(periods[0]).toMatchObject({
      payoutCount: 2,
      grossTotal: 50000,
      deductionsTotal: 3000,
      netTotal: 47000,
      delayedCount: 1,
    });
    expect(periods[1].payouts.map((p) => p.id)).toEqual(["a"]);
  });

  it("groups by property, ordered by name, with periods inside each property", () => {
    const schedules = groupPayoutsByProperty(
      [
        payout({ id: "1", propertyId: "p-yaba", propertyName: "Yaba Studio" }),
        payout({ id: "2", propertyId: "p-ajah", propertyName: "Ajah Duplex" }),
        payout({ id: "3", propertyId: "p-ajah", propertyName: "Ajah Duplex", scheduledDate: "2026-04-01T09:00:00.000Z" }),
      ],
      "monthly",
    );

    expect(schedules.map((s) => s.propertyName)).toEqual(["Ajah Duplex", "Yaba Studio"]);
    expect(schedules[0].periods.map((p) => p.periodLabel)).toEqual(["2026-01", "2026-04"]);
  });

  it("summarises gross, fees and net across payouts", () => {
    const summary = summarizePayouts([
      payout({ grossAmount: 100000, deductions: [{ type: "platform_fee", label: "Fee", amount: 5000 }] }),
      payout({ id: "2", grossAmount: 50000, status: "on_hold" }),
    ]);

    expect(summary).toMatchObject({
      totalGross: 150000,
      totalDeductions: 5000,
      totalNet: 145000,
      totalPayouts: 2,
      onHoldPayouts: 1,
      delayedPayouts: 0,
      currency: "NGN",
    });
  });

  it("returns zero totals for an empty list", () => {
    expect(summarizePayouts([])).toMatchObject({ totalGross: 0, totalNet: 0, totalPayouts: 0, currency: "NGN" });
    expect(groupPayoutsIntoPeriods([], "monthly")).toEqual([]);
  });
});
