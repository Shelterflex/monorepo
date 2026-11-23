"use client";

/**
 * Rent-to-own calculator UI (#1924).
 *
 * Only reachable while RENT_TO_OWN_ENABLED is on; otherwise notFound. All
 * arithmetic lives in lib/rentToOwnCalc.ts (unit-tested); this file only
 * collects inputs and renders the output. Estimates carry the "final terms
 * are set per deal and recorded on-chain" disclaimer.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import { Button } from "@/components/ui/button";
import { useFeatureFlag } from "@/lib/featureFlags";
import { formatNgn } from "@/lib/currency";
import {
  computeEquitySchedule,
  estimateRentToOwn,
  validateRentToOwnInputs,
  type RentToOwnInputs,
} from "@/lib/rentToOwnCalc";

const DEFAULTS: RentToOwnInputs = {
  propertyValue: 24_000_000,
  deposit: 0,
  monthlyPayment: 250_000,
  equitySharePercent: 40,
  termMonths: 24,
};

const NUMBER_FIELDS: Array<{ key: keyof RentToOwnInputs; label: string; max: number; step: number }> = [
  { key: "propertyValue", label: "Property value / purchase price (₦)", max: 500_000_000, step: 500_000 },
  { key: "deposit", label: "Initial deposit (₦)", max: 100_000_000, step: 100_000 },
  { key: "monthlyPayment", label: "Monthly payment (₦)", max: 10_000_000, step: 10_000 },
  { key: "equitySharePercent", label: "Equity share of each payment (%)", max: 100, step: 1 },
  { key: "termMonths", label: "Term (months)", max: 120, step: 1 },
];

export function RentToOwnClient() {
  const enabled = useFeatureFlag("RENT_TO_OWN_ENABLED");
  const [inputs, setInputs] = useState<RentToOwnInputs>(DEFAULTS);

  const problems = useMemo(
    () => validateRentToOwnInputs(inputs),
    [inputs],
  );

  if (!enabled) {
    // Flag off: unreachable and unlinked (#1924 acceptance). Every hook above
    // has already run, so hook order stays stable across flag flips.
    notFound();
  }

  const schedule = useMemo(
    () => (problems.length === 0 ? computeEquitySchedule(inputs) : []),
    [inputs, problems.length],
  );
  const summary = useMemo(
    () => (problems.length === 0 ? estimateRentToOwn(inputs) : null),
    [inputs, problems.length],
  );

  const chartData = schedule.map((row) => ({
    month: `M${row.month}`,
    equity: row.equity,
    totalPaid: row.totalPaid,
  }));

  return (
    <main id="main-content" className="min-h-screen bg-background">
      <section className="border-b-3 border-foreground bg-muted py-8 md:py-12">
        <div className="container mx-auto px-4">
          <h1 className="mb-3 font-mono text-2xl font-black md:text-4xl">
            Rent-to-Own <span className="text-primary">Calculator</span>
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
            See how each rent payment builds equity over time.
          </p>
          <div className="mt-3">
            <Link
              href="/calculator"
              className="text-sm font-bold underline"
            >
              Back to the installment calculator
            </Link>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8 md:py-12">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Inputs */}
          <div className="border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
            <h2 className="mb-4 font-mono text-lg font-bold">Your plan</h2>
            <div className="space-y-4">
              {NUMBER_FIELDS.map((field) => (
                <div key={field.key}>
                  <label
                    htmlFor={`rto-${field.key}`}
                    className="font-mono text-xs font-bold sm:text-sm"
                  >
                    {field.label}
                  </label>
                  <input
                    id={`rto-${field.key}`}
                    type="number"
                    min={0}
                    max={field.max}
                    step={field.step}
                    value={inputs[field.key]}
                    onChange={(event) => {
                      const parsed = Number.parseFloat(event.target.value);
                      setInputs((prev) => ({
                        ...prev,
                        [field.key]: Number.isFinite(parsed) ? parsed : 0,
                      }));
                    }}
                    className="mt-1 w-full border-3 border-foreground bg-background p-2 font-mono font-bold"
                  />
                </div>
              ))}
            </div>
            {problems.length > 0 && (
              <ul role="alert" className="mt-4 border-3 border-destructive bg-destructive/10 p-3 text-sm font-bold text-destructive">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Results */}
          <div className="space-y-6">
            {summary && (
              <div className="border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                <h2 className="mb-4 font-mono text-lg font-bold">At the end of the term</h2>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="border-2 border-foreground/20 p-3">
                    <dt className="text-xs text-muted-foreground sm:text-sm">Equity accumulated</dt>
                    <dd className="font-mono text-lg font-black md:text-xl">
                      {formatNgn(summary.equityAtEnd)}
                    </dd>
                  </div>
                  <div className="border-2 border-foreground/20 p-3">
                    <dt className="text-xs text-muted-foreground sm:text-sm">Equity share</dt>
                    <dd className="font-mono text-lg font-black md:text-xl">
                      {summary.equityPercentAtEnd}%
                    </dd>
                  </div>
                  <div className="border-2 border-foreground/20 p-3">
                    <dt className="text-xs text-muted-foreground sm:text-sm">Total paid</dt>
                    <dd className="font-mono text-lg font-black md:text-xl">
                      {formatNgn(summary.totalPaid)}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {chartData.length > 0 && (
              <div className="border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                <h2 className="mb-4 font-mono text-lg font-bold">Equity over time</h2>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <defs>
                        <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.7} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.1} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" fontSize={12} />
                      <YAxis
                        fontSize={12}
                        tickFormatter={(value: number) =>
                          new Intl.NumberFormat("en-NG", { notation: "compact" }).format(value)
                        }
                      />
                      <Tooltip
                        formatter={(value: number, name: string) =>
                          [formatNgn(value), name === "equity" ? "Equity" : "Total paid"]
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="totalPaid"
                        stroke="#888"
                        fill="#aaa"
                        fillOpacity={0.15}
                      />
                      <Area
                        type="monotone"
                        dataKey="equity"
                        stroke="hsl(var(--primary))"
                        fill="url(#equityFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <caption className="sr-only">Month-by-month equity schedule</caption>
                    <thead>
                      <tr className="border-b-3 border-foreground">
                        <th scope="col" className="p-2 text-left font-mono">Month</th>
                        <th scope="col" className="p-2 text-right font-mono">Equity</th>
                        <th scope="col" className="p-2 text-right font-mono">Total paid</th>
                        <th scope="col" className="p-2 text-right font-mono">Equity %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.map((row) => (
                        <tr key={row.month} className="border-b border-foreground/10">
                          <td className="p-2 font-mono">{row.month}</td>
                          <td className="p-2 text-right font-mono">{formatNgn(row.equity)}</td>
                          <td className="p-2 text-right font-mono">{formatNgn(row.totalPaid)}</td>
                          <td className="p-2 text-right font-mono">{row.equityPercent}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        <div role="note" className="mt-8 border-3 border-foreground bg-muted p-4 text-sm">
          <p className="font-bold">Estimate only.</p>
          <p className="mt-1 text-muted-foreground">
            These figures are illustrative. Final rent-to-own terms are set per deal and
            recorded on-chain; a real deal may include deposits, escalations or a fixed
            schedule that this calculator does not model.
          </p>
        </div>
      </section>
    </main>
  );
}
