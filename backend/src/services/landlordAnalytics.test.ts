import { describe, it, expect } from "vitest";
import {
  computeOccupancyTrend,
  computePaymentTrends,
  computeRevenueBreakdown,
  computeVacancyMetrics,
  enumerateMonths,
  resolveAnalyticsWindow,
  type PaymentRecord,
} from "./landlordAnalytics.js";

const d = (iso: string) => new Date(iso);

function errorFrom(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("month enumeration", () => {
  it("lists every month between two dates, inclusive", () => {
    expect(enumerateMonths(d("2026-01-15T00:00:00Z"), d("2026-03-01T00:00:00Z"))).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });
});

describe("occupancy trend", () => {
  const start = d("2026-01-01T00:00:00Z");
  const end = d("2026-03-31T23:59:59.999Z");

  it("reports zero for every month when there are no properties", () => {
    expect(computeOccupancyTrend([], start, end)).toEqual([
      { date: "2026-01", rate: 0 },
      { date: "2026-02", rate: 0 },
      { date: "2026-03", rate: 0 },
    ]);
  });

  it("counts a property as occupied from its deal start onward", () => {
    const trend = computeOccupancyTrend(
      [{ propertyId: "a", occupiedFrom: d("2026-02-10T00:00:00Z") }],
      start,
      end,
    );
    expect(trend.map((p) => p.rate)).toEqual([0, 100, 100]);
  });

  it("gives the share of properties occupied, as a percentage", () => {
    const trend = computeOccupancyTrend(
      [
        { propertyId: "a", occupiedFrom: d("2026-01-05T00:00:00Z") },
        { propertyId: "b" },
      ],
      start,
      end,
    );
    expect(trend.map((p) => p.rate)).toEqual([50, 50, 50]);
  });
});

describe("revenue breakdown", () => {
  it("counts expected by due month and collected by paid month", () => {
    const payments: PaymentRecord[] = [
      { amountNgn: 50000, dueDate: d("2026-02-05T00:00:00Z"), paid: true, paidAt: d("2026-02-03T00:00:00Z") },
      { amountNgn: 20000, dueDate: d("2026-02-05T00:00:00Z"), paid: false },
      // Due in January, paid in February: expected in January, collected in February.
      { amountNgn: 10000, dueDate: d("2026-01-05T00:00:00Z"), paid: true, paidAt: d("2026-02-07T00:00:00Z") },
    ];

    const breakdown = computeRevenueBreakdown(
      payments,
      d("2026-01-01T00:00:00Z"),
      d("2026-03-31T23:59:59.999Z"),
    );

    expect(breakdown).toEqual([
      { month: "2026-01", expected: 10000, collected: 0 },
      { month: "2026-02", expected: 70000, collected: 60000 },
      { month: "2026-03", expected: 0, collected: 0 },
    ]);
  });

  it("counts an instalment marked paid with no timestamp in its due month", () => {
    const breakdown = computeRevenueBreakdown(
      [{ amountNgn: 50000, dueDate: d("2026-03-05T00:00:00Z"), paid: true }],
      d("2026-03-01T00:00:00Z"),
      d("2026-03-31T23:59:59.999Z"),
    );
    expect(breakdown).toEqual([{ month: "2026-03", expected: 50000, collected: 50000 }]);
  });
});

describe("payment trends", () => {
  const start = d("2026-02-01T00:00:00Z");
  const end = d("2026-03-31T23:59:59.999Z");
  const now = d("2026-03-20T12:00:00Z");

  it("classifies on-time, late and missed instalments, and leaves out the rest", () => {
    const trends = computePaymentTrends(
      [
        // On time: paid the same day it was due.
        { amountNgn: 1, dueDate: d("2026-02-05T00:00:00Z"), paid: true, paidAt: d("2026-02-05T08:00:00Z") },
        // Late: paid after the due day.
        { amountNgn: 1, dueDate: d("2026-02-05T00:00:00Z"), paid: true, paidAt: d("2026-02-09T00:00:00Z") },
        // Missed: unpaid and already past due.
        { amountNgn: 1, dueDate: d("2026-02-10T00:00:00Z"), paid: false },
        // Not counted: unpaid and not due yet on `now`.
        { amountNgn: 1, dueDate: d("2026-03-25T00:00:00Z"), paid: false },
        // Not counted: paid, but the timing is unknown.
        { amountNgn: 1, dueDate: d("2026-03-01T00:00:00Z"), paid: true },
        // Not counted: due before the window.
        { amountNgn: 1, dueDate: d("2026-01-20T00:00:00Z"), paid: false },
      ],
      start,
      end,
      now,
    );

    expect(trends).toEqual([
      { date: "2026-02-05", onTime: 1, late: 1, missed: 0 },
      { date: "2026-02-10", onTime: 0, late: 0, missed: 1 },
    ]);
  });

  it("includes an instalment due on the last day of the window", () => {
    const trends = computePaymentTrends(
      [{ amountNgn: 1, dueDate: d("2026-03-31T18:00:00Z"), paid: true, paidAt: d("2026-03-31T18:00:00Z") }],
      start,
      end,
      now,
    );
    expect(trends).toEqual([{ date: "2026-03-31", onTime: 1, late: 0, missed: 0 }]);
  });
});

describe("vacancy metrics", () => {
  it("averages days to fill over filled vacancies only, and counts open ones as current vacancies", () => {
    const metrics = computeVacancyMetrics(
      [
        { propertyId: "vacant" },
        { propertyId: "let", occupiedFrom: d("2026-02-10T00:00:00Z") },
      ],
      [
        { availableFrom: d("2026-01-01T00:00:00Z"), filledAt: d("2026-01-31T00:00:00Z") }, // 30 days
        { availableFrom: d("2026-01-01T00:00:00Z"), filledAt: d("2026-02-10T00:00:00Z") }, // 40 days
      ],
    );
    expect(metrics).toEqual({ averageTimeToFill: 35, currentVacancyCount: 1 });
  });

  it("returns zero time-to-fill when no vacancy has been filled", () => {
    expect(computeVacancyMetrics([{ propertyId: "vacant" }], [])).toEqual({
      averageTimeToFill: 0,
      currentVacancyCount: 1,
    });
  });
});

describe("analytics window (#2054)", () => {
  const now = d("2026-11-22T10:00:00Z");

  it("uses the inclusive UTC days the caller asked for", () => {
    const window = resolveAnalyticsWindow({ startDate: "2026-01-01", endDate: "2026-03-31" }, now);
    expect(window.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-03-31T23:59:59.999Z");
  });

  it("defaults to the last 12 calendar months, ending today", () => {
    const window = resolveAnalyticsWindow({}, now);
    expect(window.start.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-22T23:59:59.999Z");
  });

  it("runs to today when only a start date is given, and back 12 months from an end date", () => {
    expect(resolveAnalyticsWindow({ startDate: "2026-01-01" }, now).end.toISOString()).toBe(
      "2026-11-22T23:59:59.999Z",
    );
    expect(resolveAnalyticsWindow({ endDate: "2026-03-31" }, now).start.toISOString()).toBe(
      "2025-04-01T00:00:00.000Z",
    );
  });

  it("rejects an inverted range with 400", () => {
    const error = errorFrom(() =>
      resolveAnalyticsWindow({ startDate: "2026-03-01", endDate: "2026-01-01" }, now),
    );
    expect(error).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
  });

  it("allows exactly 24 months and rejects 25", () => {
    expect(() =>
      resolveAnalyticsWindow({ startDate: "2024-01-01", endDate: "2025-12-31" }, now),
    ).not.toThrow();

    const error = errorFrom(() =>
      resolveAnalyticsWindow({ startDate: "2024-01-01", endDate: "2026-01-31" }, now),
    );
    expect(error).toMatchObject({ status: 400 });
  });

  it("rejects a start date after today when the end is defaulted", () => {
    const error = errorFrom(() => resolveAnalyticsWindow({ startDate: "2027-01-01" }, now));
    expect(error).toMatchObject({ status: 400 });
  });
});
