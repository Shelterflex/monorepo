/**
 * Tenant instalment schedule logic — issue #899.
 *
 * Pure helpers backing the tenant payment dashboard: deriving each
 * instalment's status (paid / due / overdue / upcoming), summarising the
 * repayment journey (total paid vs owed, next payment, arrears), and computing
 * progress. UI components consume these; all date logic takes an explicit
 * `now` so it is deterministic and testable.
 */

export type InstalmentStatus = "paid" | "due" | "overdue" | "upcoming";

export interface InstalmentInput {
  /** 1-based instalment number / month index. */
  period: number;
  dueDate: string; // ISO
  amountNgn: number;
  paid: boolean;
  paidAt?: string | null;
}

export interface InstalmentView extends InstalmentInput {
  status: InstalmentStatus;
}

export interface PaymentSummary {
  totalDue: number;
  totalPaid: number;
  /** Remaining unpaid amount. */
  outstanding: number;
  /** 0..100, rounded to a whole percent. */
  progressPercent: number;
  /** Count of unpaid instalments still ahead. */
  monthsRemaining: number;
  nextPayment: { period: number; dueDate: string; amountNgn: number } | null;
  /** Earliest overdue due date, or null when nothing is overdue. */
  overdueSince: string | null;
  /** Sum of overdue (unpaid, past-due) instalment amounts. */
  arrearsAmount: number;
}

/**
 * Window (days) within which an unpaid, not-yet-overdue instalment is "due"
 * rather than merely "upcoming". Mirrors the dashboard's next-payment card.
 */
const DUE_SOON_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derive an instalment's status. Overdue = unpaid and past its due date.
 * Due = unpaid and due within the next-payment window. Otherwise upcoming.
 */
export function deriveInstalmentStatus(
  instalment: InstalmentInput,
  now: Date = new Date(),
): InstalmentStatus {
  if (instalment.paid) return "paid";
  const due = new Date(instalment.dueDate).getTime();
  const nowMs = now.getTime();
  if (due < nowMs) return "overdue";
  if (due - nowMs <= DUE_SOON_WINDOW_DAYS * DAY_MS) return "due";
  return "upcoming";
}

/** Attach a derived status to every instalment, sorted by period ascending. */
export function buildScheduleView(
  instalments: InstalmentInput[],
  now: Date = new Date(),
): InstalmentView[] {
  return [...instalments]
    .sort((a, b) => a.period - b.period)
    .map((i) => ({ ...i, status: deriveInstalmentStatus(i, now) }));
}

/** Summarise the repayment journey for the progress tracker and alerts. */
export function summarizePayments(
  instalments: InstalmentInput[],
  now: Date = new Date(),
): PaymentSummary {
  const view = buildScheduleView(instalments, now);

  const totalDue = view.reduce((s, i) => s + i.amountNgn, 0);
  const totalPaid = view.filter((i) => i.paid).reduce((s, i) => s + i.amountNgn, 0);
  const outstanding = totalDue - totalPaid;

  const unpaidAhead = view.filter((i) => !i.paid);
  const monthsRemaining = unpaidAhead.length;

  const nextUnpaid = unpaidAhead
    .slice()
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
  const nextPayment = nextUnpaid
    ? { period: nextUnpaid.period, dueDate: nextUnpaid.dueDate, amountNgn: nextUnpaid.amountNgn }
    : null;

  const overdue = view.filter((i) => i.status === "overdue");
  const overdueSince =
    overdue.length > 0
      ? overdue
          .map((i) => i.dueDate)
          .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
      : null;
  const arrearsAmount = overdue.reduce((s, i) => s + i.amountNgn, 0);

  const progressPercent = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;

  return {
    totalDue,
    totalPaid,
    outstanding,
    progressPercent,
    monthsRemaining,
    nextPayment,
    overdueSince,
    arrearsAmount,
  };
}

/** True when the tenant has at least one overdue instalment. */
export function hasArrears(instalments: InstalmentInput[], now: Date = new Date()): boolean {
  return instalments.some((i) => deriveInstalmentStatus(i, now) === "overdue");
}
