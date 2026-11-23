import { describe, expect, it } from "vitest";
import {
  computeEquitySchedule,
  estimateRentToOwn,
  equityPercentOf,
  validateRentToOwnInputs,
} from "../rentToOwnCalc";

const base = {
  propertyValue: 24_000_000,
  deposit: 0,
  monthlyPayment: 250_000,
  equitySharePercent: 40,
  termMonths: 12,
};

describe("rentToOwnCalc (#1924, #2065)", () => {
  it("accumulates equity month over month", () => {
    const rows = computeEquitySchedule(base);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({
      month: 1,
      equity: 100_000,
      totalPaid: 250_000,
      equityPercent: expect.closeTo(0.42, 1),
    });
    expect(rows[11].equity).toBeCloseTo(1_200_000, 6);
    expect(rows[11].totalPaid).toBeCloseTo(3_000_000, 6);
    // 1.2m of a 24m property is 5%.
    expect(rows[11].equityPercent).toBeCloseTo(5, 6);
  });

  it("handles initial deposit accurately", () => {
    const rows = computeEquitySchedule({ ...base, deposit: 1_000_000 });
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({
      month: 1,
      equity: 1_100_000,
      totalPaid: 1_250_000,
      equityPercent: expect.closeTo(4.58, 1),
    });
    expect(rows[11].equity).toBeCloseTo(2_200_000, 6);
    expect(rows[11].totalPaid).toBeCloseTo(4_000_000, 6);
  });

  it("keeps equity at zero for a 0% equity share with zero deposit", () => {
    const summary = estimateRentToOwn({ ...base, equitySharePercent: 0, deposit: 0 });
    expect(summary.equityAtEnd).toBe(0);
    expect(summary.equityPercentAtEnd).toBe(0);
    expect(summary.totalPaid).toBeCloseTo(3_000_000, 6);
  });

  it("closes the gap between equity and total paid at a 100% equity share", () => {
    const summary = estimateRentToOwn({ ...base, equitySharePercent: 100 });
    expect(summary.equityAtEnd).toBeCloseTo(summary.totalPaid);
    expect(summary.equityPercentAtEnd).toBeCloseTo(
      equityPercentOf(24_000_000, summary.totalPaid),
    );
  });

  it("handles a one-month term where equity equals a single payment", () => {
    const rows = computeEquitySchedule({ ...base, termMonths: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].month).toBe(1);
    expect(rows[0].equity).toBeCloseTo(100_000, 6);
    expect(rows[0].totalPaid).toBeCloseTo(250_000, 6);
  });

  it("rounds fractional payments to two decimals without drift", () => {
    const rows = computeEquitySchedule({
      propertyValue: 1_000_000,
      monthlyPayment: 19.99,
      equitySharePercent: 33,
      termMonths: 3,
    });
    const expectedMonthly = Math.round(((19.99 * 33) / 100) * 100) / 100; // 6.60
    for (const [index, row] of rows.entries()) {
      expect(row.equity).toBeCloseTo(expectedMonthly * (index + 1), 6);
    }
  });

  it("returns fit-for-use percentages and zero equity for odd inputs", () => {
    expect(equityPercentOf(0, 100)).toBe(0);
    expect(equityPercentOf(-5, 100)).toBe(0);
    expect(equityPercentOf(200, 1)).toBe(0.5);
  });

  describe("table-driven cases including zero deposit and boundary month", () => {
    const testCases = [
      {
        desc: "zero deposit with 1 month boundary",
        inputs: { propertyValue: 12_000_000, deposit: 0, monthlyPayment: 200_000, equitySharePercent: 50, termMonths: 1 },
        expectedEndEquity: 100_000,
        expectedEndTotalPaid: 200_000,
        expectedEndPercent: 0.83,
      },
      {
        desc: "zero deposit with 12 months",
        inputs: { propertyValue: 10_000_000, deposit: 0, monthlyPayment: 100_000, equitySharePercent: 50, termMonths: 12 },
        expectedEndEquity: 600_000,
        expectedEndTotalPaid: 1_200_000,
        expectedEndPercent: 6.0,
      },
      {
        desc: "with deposit at 1 month boundary",
        inputs: { propertyValue: 10_000_000, deposit: 2_000_000, monthlyPayment: 100_000, equitySharePercent: 50, termMonths: 1 },
        expectedEndEquity: 2_050_000,
        expectedEndTotalPaid: 2_100_000,
        expectedEndPercent: 20.5,
      },
      {
        desc: "with deposit and purchasePrice alias across 24 months boundary",
        inputs: { propertyValue: 0, purchasePrice: 50_000_000, deposit: 5_000_000, monthlyPayment: 500_000, equitySharePercent: 20, termMonths: 24 },
        expectedEndEquity: 5_000_000 + (100_000 * 24), // 7_400_000
        expectedEndTotalPaid: 5_000_000 + (500_000 * 24), // 17_000_000
        expectedEndPercent: 14.8,
      },
    ];

    it.each(testCases)("$desc", ({ inputs, expectedEndEquity, expectedEndTotalPaid, expectedEndPercent }) => {
      const summary = estimateRentToOwn(inputs);
      expect(summary.equityAtEnd).toBeCloseTo(expectedEndEquity, 2);
      expect(summary.totalPaid).toBeCloseTo(expectedEndTotalPaid, 2);
      expect(summary.equityPercentAtEnd).toBeCloseTo(expectedEndPercent, 2);
    });
  });

  describe("validateRentToOwnInputs", () => {
    it("accepts a valid plan", () => {
      expect(validateRentToOwnInputs(base)).toEqual([]);
    });

    it("accepts purchasePrice alias and non-negative deposit", () => {
      expect(
        validateRentToOwnInputs({
          purchasePrice: 20_000_000,
          deposit: 1_000_000,
          monthlyPayment: 200_000,
          equitySharePercent: 30,
          termMonths: 12,
        }),
      ).toEqual([]);
    });

    it("rejects non-positive money, negative deposit, and out-of-range shares", () => {
      const problems = validateRentToOwnInputs({
        propertyValue: 0,
        deposit: -100,
        monthlyPayment: -1,
        equitySharePercent: 150,
        termMonths: 0,
      });
      expect(problems).toHaveLength(5);
    });

    it("rejects a fractional term", () => {
      expect(
        validateRentToOwnInputs({ ...base, termMonths: 1.5 }),
      ).toContain("Term must be at least 1 month");
    });
  });
});
