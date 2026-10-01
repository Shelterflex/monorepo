import { describe, it, expect } from "vitest";
import {
  generateRepaymentSchedule,
  updateScheduleStatuses,
  calculateTotalPaid,
  calculateRemainingBalance,
  type ScheduleGeneratorInput,
} from "../scheduleGenerator.js";
import { ScheduleItemStatus } from "../../models/deal.js";

describe("scheduleGenerator (Issue #1761)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  describe("generateRepaymentSchedule - Normal Cases", () => {
    it("generates a standard 12-month repayment schedule with correct period count and dates", () => {
      const input: ScheduleGeneratorInput = {
        annualRentNgn: 1_200_000,
        depositNgn: 200_000,
        termMonths: 12,
        startDate: new Date("2026-01-15T00:00:00.000Z"),
      };

      const schedule = generateRepaymentSchedule(input);

      expect(schedule).toHaveLength(12);

      // Verify sequence of periods
      schedule.forEach((item, index) => {
        expect(item.period).toBe(index + 1);
        expect(item.status).toBe(ScheduleItemStatus.UPCOMING);
      });

      // Financed amount = 1,000,000 / 12 = 83,333.33 per month
      // 11 * 83,333.33 = 916,666.63 -> final payment = 1,000,000 - 916,666.63 = 83,333.37
      expect(schedule[0].amountNgn).toBe(83_333.33);
      expect(schedule[11].amountNgn).toBe(83_333.37);

      // Verify total sum equals exactly financedAmount
      const totalAmount = schedule.reduce((sum, item) => sum + item.amountNgn, 0);
      expect(totalAmount).toBeCloseTo(1_000_000, 2);
    });

    it("handles 6-month term with clean divisibility", () => {
      const input: ScheduleGeneratorInput = {
        annualRentNgn: 600_000,
        depositNgn: 0,
        termMonths: 6,
        startDate: new Date("2026-03-10T00:00:00.000Z"),
      };

      const schedule = generateRepaymentSchedule(input);

      expect(schedule).toHaveLength(6);
      schedule.forEach((item) => {
        expect(item.amountNgn).toBe(100_000);
        expect(item.status).toBe(ScheduleItemStatus.UPCOMING);
      });

      const total = schedule.reduce((acc, curr) => acc + curr.amountNgn, 0);
      expect(total).toBe(600_000);
    });

    it("reconciles rounding discrepancies in the final payment", () => {
      // 100,000 / 3 = 33,333.33 repeating
      const input: ScheduleGeneratorInput = {
        annualRentNgn: 100_000,
        depositNgn: 0,
        termMonths: 3,
        startDate: new Date("2026-05-01T00:00:00.000Z"),
      };

      const schedule = generateRepaymentSchedule(input);

      expect(schedule).toHaveLength(3);
      expect(schedule[0].amountNgn).toBe(33_333.33);
      expect(schedule[1].amountNgn).toBe(33_333.33);
      expect(schedule[2].amountNgn).toBe(33_333.34);

      const total = schedule.reduce((sum, item) => sum + item.amountNgn, 0);
      expect(total).toBe(100_000);
    });
  });

  describe("generateRepaymentSchedule - Edge Cases", () => {
    it("handles single-period deal (termMonths: 1)", () => {
      const input: ScheduleGeneratorInput = {
        annualRentNgn: 500_000,
        depositNgn: 100_000,
        termMonths: 1,
        startDate: new Date("2026-06-01T00:00:00.000Z"),
      };

      const schedule = generateRepaymentSchedule(input);

      expect(schedule).toHaveLength(1);
      expect(schedule[0].period).toBe(1);
      expect(schedule[0].amountNgn).toBe(400_000);
      expect(schedule[0].status).toBe(ScheduleItemStatus.UPCOMING);
      expect(new Date(schedule[0].dueDate).getMonth()).toBe(6); // July (0-indexed 6)
    });

    it("handles full deposit (zero financed amount)", () => {
      const input: ScheduleGeneratorInput = {
        annualRentNgn: 300_000,
        depositNgn: 300_000,
        termMonths: 3,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
      };

      const schedule = generateRepaymentSchedule(input);

      expect(schedule).toHaveLength(3);
      schedule.forEach((item) => {
        expect(item.amountNgn).toBe(0);
      });
      const total = schedule.reduce((sum, item) => sum + item.amountNgn, 0);
      expect(total).toBe(0);
    });

    it("documents date progression for leap year start dates (e.g. 2028 leap year)", () => {
      const input: ScheduleGeneratorInput = {
        annualRentNgn: 240_000,
        depositNgn: 0,
        termMonths: 3,
        startDate: new Date("2028-02-29T12:00:00.000Z"), // Leap day
      };

      const schedule = generateRepaymentSchedule(input);
      expect(schedule).toHaveLength(3);

      // Month addition on Feb 29:
      // +1 month -> March 29
      // +2 months -> April 29
      // +3 months -> May 29
      const due0 = new Date(schedule[0].dueDate);
      const due1 = new Date(schedule[1].dueDate);
      const due2 = new Date(schedule[2].dueDate);

      expect(due0.getUTCMonth()).toBe(2); // March
      expect(due0.getUTCDate()).toBe(29);
      expect(due1.getUTCMonth()).toBe(3); // April
      expect(due1.getUTCDate()).toBe(29);
      expect(due2.getUTCMonth()).toBe(4); // May
      expect(due2.getUTCDate()).toBe(29);
    });

    it("surfaces month-end rollover behavior for 31st start dates (reporting note for date bug)", () => {
      // NOTE for Issue #1761: When startDate is on the 31st, JS Date setMonth() overflows
      // months with fewer than 31 days (e.g. Jan 31 + 1 month rolls over into March).
      const input: ScheduleGeneratorInput = {
        annualRentNgn: 300_000,
        depositNgn: 0,
        termMonths: 3,
        startDate: new Date("2026-01-31T00:00:00.000Z"),
      };

      const schedule = generateRepaymentSchedule(input);
      expect(schedule).toHaveLength(3);

      // Verifies the existing setMonth behavior in scheduleGenerator.ts:
      // Period 1 (Jan 31 + 1 month): In 2026 (non-leap), Feb has 28 days, so 31 rolls over into March (March 3)
      const datePeriod1 = new Date(schedule[0].dueDate);
      expect(datePeriod1.getUTCMonth()).toBe(2); // Month index 2 is March
    });
  });

  describe("updateScheduleStatuses", () => {
    const baseSchedule = [
      {
        period: 1,
        dueDate: "2026-06-01T00:00:00.000Z",
        amountNgn: 50_000,
        status: ScheduleItemStatus.UPCOMING,
      },
      {
        period: 2,
        dueDate: "2026-06-15T00:00:00.000Z",
        amountNgn: 50_000,
        status: ScheduleItemStatus.UPCOMING,
      },
      {
        period: 3,
        dueDate: "2026-07-01T00:00:00.000Z",
        amountNgn: 50_000,
        status: ScheduleItemStatus.UPCOMING,
      },
    ];

    it("marks periods in paidPeriods as PAID regardless of current date", () => {
      const now = new Date("2026-08-01T00:00:00.000Z"); // Long after due dates
      const updated = updateScheduleStatuses(baseSchedule, now, [1, 2]);

      expect(updated[0].status).toBe(ScheduleItemStatus.PAID);
      expect(updated[1].status).toBe(ScheduleItemStatus.PAID);
      expect(updated[2].status).toBe(ScheduleItemStatus.LATE);
    });

    it("marks future instalments as UPCOMING when currentDate < dueDate", () => {
      const now = new Date("2026-05-15T00:00:00.000Z"); // Before all due dates
      const updated = updateScheduleStatuses(baseSchedule, now, []);

      expect(updated[0].status).toBe(ScheduleItemStatus.UPCOMING);
      expect(updated[1].status).toBe(ScheduleItemStatus.UPCOMING);
      expect(updated[2].status).toBe(ScheduleItemStatus.UPCOMING);
    });

    it("marks instalments as DUE when within 5-day grace period", () => {
      // Due date is 2026-06-15
      const dueDate = new Date("2026-06-15T00:00:00.000Z");

      // Exactly on due date
      const atDue = updateScheduleStatuses(baseSchedule, dueDate, []);
      expect(atDue[1].status).toBe(ScheduleItemStatus.DUE);

      // 3 days after due date
      const inGrace = updateScheduleStatuses(
        baseSchedule,
        new Date(dueDate.getTime() + 3 * DAY_MS),
        []
      );
      expect(inGrace[1].status).toBe(ScheduleItemStatus.DUE);

      // Exactly at grace period end (5 days after due date)
      const atGraceEnd = updateScheduleStatuses(
        baseSchedule,
        new Date(dueDate.getTime() + 5 * DAY_MS),
        []
      );
      expect(atGraceEnd[1].status).toBe(ScheduleItemStatus.DUE);
    });

    it("marks instalments as LATE when currentDate is past the 5-day grace period", () => {
      const dueDate = new Date("2026-06-15T00:00:00.000Z");
      // 5 days + 1 ms after due date
      const pastGrace = new Date(dueDate.getTime() + 5 * DAY_MS + 1);

      const updated = updateScheduleStatuses(baseSchedule, pastGrace, []);
      expect(updated[1].status).toBe(ScheduleItemStatus.LATE);
    });

    it("uses new Date() as default currentDate when omitted", () => {
      const farFutureSchedule = [
        {
          period: 1,
          dueDate: new Date(Date.now() + 60 * DAY_MS).toISOString(),
          amountNgn: 50_000,
          status: ScheduleItemStatus.UPCOMING,
        },
      ];

      const updated = updateScheduleStatuses(farFutureSchedule);
      expect(updated[0].status).toBe(ScheduleItemStatus.UPCOMING);
    });
  });

  describe("calculateTotalPaid", () => {
    const schedule = [
      { period: 1, dueDate: "2026-01-01", amountNgn: 30_000, status: ScheduleItemStatus.PAID },
      { period: 2, dueDate: "2026-02-01", amountNgn: 35_000, status: ScheduleItemStatus.PAID },
      { period: 3, dueDate: "2026-03-01", amountNgn: 35_000, status: ScheduleItemStatus.UPCOMING },
    ];

    it("returns 0 when paidPeriods is empty", () => {
      expect(calculateTotalPaid(schedule, [])).toBe(0);
    });

    it("returns the exact sum of paid instalments", () => {
      expect(calculateTotalPaid(schedule, [1])).toBe(30_000);
      expect(calculateTotalPaid(schedule, [1, 2])).toBe(65_000);
      expect(calculateTotalPaid(schedule, [1, 2, 3])).toBe(100_000);
    });

    it("handles non-existent period IDs gracefully", () => {
      expect(calculateTotalPaid(schedule, [99, 100])).toBe(0);
      expect(calculateTotalPaid(schedule, [1, 99])).toBe(30_000);
    });
  });

  describe("calculateRemainingBalance", () => {
    const schedule = [
      { period: 1, dueDate: "2026-01-01", amountNgn: 40_000, status: ScheduleItemStatus.PAID },
      { period: 2, dueDate: "2026-02-01", amountNgn: 40_000, status: ScheduleItemStatus.UPCOMING },
      { period: 3, dueDate: "2026-03-01", amountNgn: 20_000, status: ScheduleItemStatus.UPCOMING },
    ];

    it("returns total amount when no periods are paid", () => {
      expect(calculateRemainingBalance(schedule, [])).toBe(100_000);
    });

    it("subtracts paid periods correctly", () => {
      expect(calculateRemainingBalance(schedule, [1])).toBe(60_000);
      expect(calculateRemainingBalance(schedule, [1, 2])).toBe(20_000);
    });

    it("returns 0 when all periods are paid", () => {
      expect(calculateRemainingBalance(schedule, [1, 2, 3])).toBe(0);
    });
  });
});
