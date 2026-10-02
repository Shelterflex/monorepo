import { describe, it, expect } from "vitest";
import {
  deriveInstalmentStatus,
  buildScheduleView,
  summarizePayments,
  hasArrears,
  type InstalmentInput,
} from "./installmentSchedule.js";

describe("installmentSchedule (Issue #1762)", () => {
  // Reference base time: 2026-06-15T12:00:00.000Z
  const BASE_NOW = new Date("2026-06-15T12:00:00.000Z");
  const DAY_MS = 24 * 60 * 60 * 1000;

  describe("deriveInstalmentStatus", () => {
    it("returns 'paid' when instalment.paid is true, even if dueDate is past or future", () => {
      const pastPaid: InstalmentInput = {
        period: 1,
        dueDate: "2026-05-01T00:00:00.000Z",
        amountNgn: 150_000,
        paid: true,
        paidAt: "2026-04-30T10:00:00.000Z",
      };
      const futurePaid: InstalmentInput = {
        period: 2,
        dueDate: "2026-07-01T00:00:00.000Z",
        amountNgn: 150_000,
        paid: true,
        paidAt: "2026-06-10T10:00:00.000Z",
      };

      expect(deriveInstalmentStatus(pastPaid, BASE_NOW)).toBe("paid");
      expect(deriveInstalmentStatus(futurePaid, BASE_NOW)).toBe("paid");
    });

    it("returns 'overdue' when unpaid and dueDate is strictly before now", () => {
      const pastUnpaid: InstalmentInput = {
        period: 1,
        dueDate: "2026-06-14T23:59:59.000Z",
        amountNgn: 100_000,
        paid: false,
      };

      expect(deriveInstalmentStatus(pastUnpaid, BASE_NOW)).toBe("overdue");
    });

    it("returns 'due' when unpaid and dueDate is within 7 days in the future", () => {
      // Exactly at now: due - now == 0 <= 7 days
      const dueRightNow: InstalmentInput = {
        period: 1,
        dueDate: BASE_NOW.toISOString(),
        amountNgn: 100_000,
        paid: false,
      };

      // 3 days ahead
      const dueIn3Days: InstalmentInput = {
        period: 2,
        dueDate: new Date(BASE_NOW.getTime() + 3 * DAY_MS).toISOString(),
        amountNgn: 100_000,
        paid: false,
      };

      // Exactly at 7-day boundary
      const dueAt7DayBoundary: InstalmentInput = {
        period: 3,
        dueDate: new Date(BASE_NOW.getTime() + 7 * DAY_MS).toISOString(),
        amountNgn: 100_000,
        paid: false,
      };

      expect(deriveInstalmentStatus(dueRightNow, BASE_NOW)).toBe("due");
      expect(deriveInstalmentStatus(dueIn3Days, BASE_NOW)).toBe("due");
      expect(deriveInstalmentStatus(dueAt7DayBoundary, BASE_NOW)).toBe("due");
    });

    it("returns 'upcoming' when unpaid and dueDate is more than 7 days ahead", () => {
      // 7 days and 1 millisecond ahead
      const upcomingBoundary: InstalmentInput = {
        period: 1,
        dueDate: new Date(BASE_NOW.getTime() + 7 * DAY_MS + 1).toISOString(),
        amountNgn: 100_000,
        paid: false,
      };

      // 30 days ahead
      const upcomingFar: InstalmentInput = {
        period: 2,
        dueDate: new Date(BASE_NOW.getTime() + 30 * DAY_MS).toISOString(),
        amountNgn: 100_000,
        paid: false,
      };

      expect(deriveInstalmentStatus(upcomingBoundary, BASE_NOW)).toBe("upcoming");
      expect(deriveInstalmentStatus(upcomingFar, BASE_NOW)).toBe("upcoming");
    });

    it("uses current time as default when now is omitted", () => {
      const farFutureUnpaid: InstalmentInput = {
        period: 1,
        dueDate: new Date(Date.now() + 60 * DAY_MS).toISOString(),
        amountNgn: 50_000,
        paid: false,
      };

      expect(deriveInstalmentStatus(farFutureUnpaid)).toBe("upcoming");
    });
  });

  describe("buildScheduleView", () => {
    it("sorts instalments by period ascending and assigns correct derived status", () => {
      const unsortedInstalments: InstalmentInput[] = [
        {
          period: 3,
          dueDate: new Date(BASE_NOW.getTime() + 20 * DAY_MS).toISOString(),
          amountNgn: 100_000,
          paid: false,
        },
        {
          period: 1,
          dueDate: new Date(BASE_NOW.getTime() - 10 * DAY_MS).toISOString(),
          amountNgn: 100_000,
          paid: true,
          paidAt: new Date(BASE_NOW.getTime() - 12 * DAY_MS).toISOString(),
        },
        {
          period: 2,
          dueDate: new Date(BASE_NOW.getTime() + 3 * DAY_MS).toISOString(),
          amountNgn: 100_000,
          paid: false,
        },
      ];

      const view = buildScheduleView(unsortedInstalments, BASE_NOW);

      expect(view).toHaveLength(3);
      expect(view[0].period).toBe(1);
      expect(view[0].status).toBe("paid");
      expect(view[1].period).toBe(2);
      expect(view[1].status).toBe("due");
      expect(view[2].period).toBe(3);
      expect(view[2].status).toBe("upcoming");
    });

    it("does not mutate original array", () => {
      const original: InstalmentInput[] = [
        { period: 2, dueDate: "2026-07-01T00:00:00.000Z", amountNgn: 50_000, paid: false },
        { period: 1, dueDate: "2026-06-01T00:00:00.000Z", amountNgn: 50_000, paid: true },
      ];

      const copyBefore = [...original];
      buildScheduleView(original, BASE_NOW);

      expect(original).toEqual(copyBefore);
    });
  });

  describe("summarizePayments", () => {
    it("handles empty schedule gracefully", () => {
      const summary = summarizePayments([], BASE_NOW);

      expect(summary).toEqual({
        totalDue: 0,
        totalPaid: 0,
        outstanding: 0,
        progressPercent: 0,
        monthsRemaining: 0,
        nextPayment: null,
        overdueSince: null,
        arrearsAmount: 0,
      });
    });

    it("summarises when no payments have been made yet", () => {
      const instalments: InstalmentInput[] = [
        {
          period: 1,
          dueDate: new Date(BASE_NOW.getTime() + 2 * DAY_MS).toISOString(),
          amountNgn: 200_000,
          paid: false,
        },
        {
          period: 2,
          dueDate: new Date(BASE_NOW.getTime() + 32 * DAY_MS).toISOString(),
          amountNgn: 200_000,
          paid: false,
        },
      ];

      const summary = summarizePayments(instalments, BASE_NOW);

      expect(summary.totalDue).toBe(400_000);
      expect(summary.totalPaid).toBe(0);
      expect(summary.outstanding).toBe(400_000);
      expect(summary.progressPercent).toBe(0);
      expect(summary.monthsRemaining).toBe(2);
      expect(summary.nextPayment).toEqual({
        period: 1,
        dueDate: instalments[0].dueDate,
        amountNgn: 200_000,
      });
      expect(summary.overdueSince).toBeNull();
      expect(summary.arrearsAmount).toBe(0);
    });

    it("summarises fully paid journey", () => {
      const instalments: InstalmentInput[] = [
        {
          period: 1,
          dueDate: "2026-04-01T00:00:00.000Z",
          amountNgn: 150_000,
          paid: true,
          paidAt: "2026-03-31T10:00:00.000Z",
        },
        {
          period: 2,
          dueDate: "2026-05-01T00:00:00.000Z",
          amountNgn: 150_000,
          paid: true,
          paidAt: "2026-04-30T10:00:00.000Z",
        },
      ];

      const summary = summarizePayments(instalments, BASE_NOW);

      expect(summary.totalDue).toBe(300_000);
      expect(summary.totalPaid).toBe(300_000);
      expect(summary.outstanding).toBe(0);
      expect(summary.progressPercent).toBe(100);
      expect(summary.monthsRemaining).toBe(0);
      expect(summary.nextPayment).toBeNull();
      expect(summary.overdueSince).toBeNull();
      expect(summary.arrearsAmount).toBe(0);
    });

    it("calculates partial payment progress rounded to nearest whole percent", () => {
      const instalments: InstalmentInput[] = [
        { period: 1, dueDate: "2026-04-01T00:00:00.000Z", amountNgn: 100_000, paid: true },
        {
          period: 2,
          dueDate: new Date(BASE_NOW.getTime() + 4 * DAY_MS).toISOString(),
          amountNgn: 100_000,
          paid: false,
        },
        {
          period: 3,
          dueDate: new Date(BASE_NOW.getTime() + 34 * DAY_MS).toISOString(),
          amountNgn: 100_000,
          paid: false,
        },
      ];

      const summary = summarizePayments(instalments, BASE_NOW);

      expect(summary.totalDue).toBe(300_000);
      expect(summary.totalPaid).toBe(100_000);
      expect(summary.outstanding).toBe(200_000);
      // 100_000 / 300_000 = 33.333% -> rounds to 33%
      expect(summary.progressPercent).toBe(33);
      expect(summary.monthsRemaining).toBe(2);
      expect(summary.nextPayment).toEqual({
        period: 2,
        dueDate: instalments[1].dueDate,
        amountNgn: 100_000,
      });
      expect(summary.arrearsAmount).toBe(0);
      expect(summary.overdueSince).toBeNull();
    });

    it("correctly identifies multiple overdue instalments, arrears sum, and earliest overdue date", () => {
      const overdueDate1 = "2026-04-15T12:00:00.000Z";
      const overdueDate2 = "2026-05-15T12:00:00.000Z";

      const instalments: InstalmentInput[] = [
        { period: 1, dueDate: overdueDate1, amountNgn: 120_000, paid: false },
        { period: 2, dueDate: overdueDate2, amountNgn: 130_000, paid: false },
        {
          period: 3,
          dueDate: new Date(BASE_NOW.getTime() + 20 * DAY_MS).toISOString(),
          amountNgn: 140_000,
          paid: false,
        },
      ];

      const summary = summarizePayments(instalments, BASE_NOW);

      expect(summary.totalDue).toBe(390_000);
      expect(summary.totalPaid).toBe(0);
      expect(summary.outstanding).toBe(390_000);
      expect(summary.progressPercent).toBe(0);
      expect(summary.monthsRemaining).toBe(3);
      expect(summary.arrearsAmount).toBe(250_000); // 120_000 + 130_000
      expect(summary.overdueSince).toBe(overdueDate1);
      // nextPayment picks the earliest unpaid due date
      expect(summary.nextPayment).toEqual({
        period: 1,
        dueDate: overdueDate1,
        amountNgn: 120_000,
      });
    });
  });

  describe("hasArrears", () => {
    it("returns false when schedule is empty", () => {
      expect(hasArrears([], BASE_NOW)).toBe(false);
    });

    it("returns false when all instalments are paid", () => {
      const instalments: InstalmentInput[] = [
        { period: 1, dueDate: "2026-05-01T00:00:00.000Z", amountNgn: 100_000, paid: true },
        { period: 2, dueDate: "2026-06-01T00:00:00.000Z", amountNgn: 100_000, paid: true },
      ];
      expect(hasArrears(instalments, BASE_NOW)).toBe(false);
    });

    it("returns false when unpaid instalments are due in the future (due soon or upcoming)", () => {
      const instalments: InstalmentInput[] = [
        {
          period: 1,
          dueDate: new Date(BASE_NOW.getTime() + 2 * DAY_MS).toISOString(),
          amountNgn: 100_000,
          paid: false,
        },
        {
          period: 2,
          dueDate: new Date(BASE_NOW.getTime() + 20 * DAY_MS).toISOString(),
          amountNgn: 100_000,
          paid: false,
        },
      ];
      expect(hasArrears(instalments, BASE_NOW)).toBe(false);
    });

    it("returns true when at least one unpaid instalment is past due", () => {
      const instalments: InstalmentInput[] = [
        { period: 1, dueDate: "2026-05-01T00:00:00.000Z", amountNgn: 100_000, paid: true },
        { period: 2, dueDate: "2026-06-01T00:00:00.000Z", amountNgn: 100_000, paid: false },
        {
          period: 3,
          dueDate: new Date(BASE_NOW.getTime() + 15 * DAY_MS).toISOString(),
          amountNgn: 100_000,
          paid: false,
        },
      ];
      expect(hasArrears(instalments, BASE_NOW)).toBe(true);
    });
  });
});
