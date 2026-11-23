/**
 * Rent-to-own equity calculator (#1924, #2065).
 *
 * Model
 * -----
 * The renter pays `monthlyPayment` every month, starting optionally with `deposit`.
 * Each monthly payment contributes `equitySharePercent` of it toward a growing
 * equity stake in the property:
 *
 *     monthlyEquity(m) = monthlyPayment * equitySharePercent / 100
 *     equity(m)        = deposit + monthlyEquity * m
 *     paid(m)          = deposit + monthlyPayment * m
 *     equityPercent    = equity / purchasePrice * 100
 *
 * These are estimates only — final terms are set per deal and recorded on-chain.
 */

export interface RentToOwnInputs {
  /** Full value or purchase price of the property (NGN). Must be > 0. */
  propertyValue: number;
  /** Optional alias for propertyValue / purchase price. */
  purchasePrice?: number;
  /** Initial deposit toward equity (NGN, >= 0). Defaults to 0. */
  deposit?: number;
  /** Total rent paid each month (NGN). Must be > 0. */
  monthlyPayment: number;
  /** Share of each payment that builds equity (percent, 0–100). */
  equitySharePercent: number;
  /** Term of the arrangement (months, >= 1). */
  termMonths: number;
}

export interface EquityScheduleRow {
  month: number;
  equity: number;
  totalPaid: number;
  equityPercent: number;
}

export interface RentToOwnSummary {
  /** Equity accumulated at the end of the term (NGN). */
  equityAtEnd: number;
  /** Equity as a percentage of the property value at the end of the term. */
  equityPercentAtEnd: number;
  /** Total amount paid over the whole term (NGN). */
  totalPaid: number;
}

/**
 * Validates the raw input the calculator page collects. Returns a list of
 * user-facing problems; an empty list means the inputs are usable.
 */
export function validateRentToOwnInputs(raw: {
  propertyValue?: number;
  purchasePrice?: number;
  deposit?: number;
  monthlyPayment: number;
  equitySharePercent: number;
  termMonths: number;
}): string[] {
  const problems: string[] = [];
  const finite = (v: number) => Number.isFinite(v);
  const price = raw.purchasePrice ?? raw.propertyValue ?? 0;

  if (!finite(price) || price <= 0) {
    problems.push("Property value must be greater than 0");
  }
  if (raw.deposit !== undefined && (!finite(raw.deposit) || raw.deposit < 0)) {
    problems.push("Deposit must be greater than or equal to 0");
  }
  if (!finite(raw.monthlyPayment) || raw.monthlyPayment <= 0) {
    problems.push("Monthly payment must be greater than 0");
  }
  if (
    !finite(raw.equitySharePercent) ||
    raw.equitySharePercent < 0 ||
    raw.equitySharePercent > 100
  ) {
    problems.push("Equity share must be between 0 and 100 percent");
  }
  if (!Number.isInteger(raw.termMonths) || raw.termMonths < 1) {
    problems.push("Term must be at least 1 month");
  }
  return problems;
}

/** Monthly equity contribution in kobo-exact NGN. Rounded to whole naira. */
function monthlyEquityNgn(inputs: RentToOwnInputs): number {
  const raw = (inputs.monthlyPayment * inputs.equitySharePercent) / 100;
  return Math.round(raw * 100) / 100;
}

/**
 * Month-by-month schedule. Row m holds the running totals paid after the m-th
 * payment.
 */
export function computeEquitySchedule(inputs: RentToOwnInputs): EquityScheduleRow[] {
  const price = inputs.purchasePrice ?? inputs.propertyValue;
  const deposit = inputs.deposit ?? 0;
  const rows: EquityScheduleRow[] = [];
  let equity = deposit;
  const monthlyEquity = monthlyEquityNgn(inputs);

  for (let month = 1; month <= inputs.termMonths; month++) {
    equity += monthlyEquity;
    const totalPaid = round2(deposit + inputs.monthlyPayment * month);
    rows.push({
      month,
      equity: round2(equity),
      totalPaid,
      equityPercent: equityPercentOf(price, equity),
    });
  }
  return rows;
}

/** Compact end-of-term figures derived from the schedule. */
export function estimateRentToOwn(inputs: RentToOwnInputs): RentToOwnSummary {
  const schedule = computeEquitySchedule(inputs);
  const last = schedule[schedule.length - 1];
  return {
    equityAtEnd: last.equity,
    equityPercentAtEnd: last.equityPercent,
    totalPaid: last.totalPaid,
  };
}

/** Equity percentage of the property value; 0 for a non-positive value. */
export function equityPercentOf(propertyValue: number, equity: number): number {
  if (!Number.isFinite(propertyValue) || propertyValue <= 0) return 0;
  return Math.round((equity / propertyValue) * 100 * 100) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
