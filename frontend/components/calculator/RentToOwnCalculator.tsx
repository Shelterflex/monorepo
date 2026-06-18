"use client";

import { useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Info, AlertCircle } from "lucide-react";
import {
  calcRentToOwn,
  ANNUAL_INTEREST_RATE,
  ESTIMATED_RENTAL_YIELD,
} from "@/lib/rentToOwnCalc";
import dynamic from "next/dynamic";

const EquityProgressChart = dynamic(() => import("./EquityProgressChart"), {
  ssr: false,
  loading: () => (
    <div className="border-3 border-foreground bg-card p-4 md:p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] animate-pulse">
      <div className="h-4 w-48 bg-muted rounded mb-1" />
      <div className="h-3 w-64 bg-muted rounded mb-4" />
      <div className="h-56 md:h-72 w-full bg-muted rounded" />
    </div>
  ),
});
import RentToOwnPlanCard from "./RentToOwnPlanCard";

function formatFull(val: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

export default function RentToOwnCalculator() {
  const [propertyPrice, setPropertyPrice] = useState(15_000_000);
  const [depositPct, setDepositPct] = useState(20);
  const [monthlyBudget, setMonthlyBudget] = useState(300_000);
  const [ownershipYears, setOwnershipYears] = useState(10);

  const result = useMemo(
    () =>
      calcRentToOwn({ propertyPrice, depositPct, monthlyBudget, ownershipYears }),
    [propertyPrice, depositPct, monthlyBudget, ownershipYears],
  );

  // Downsample the schedule for the chart (max 60 points) to keep it readable
  const chartData = useMemo(() => {
    const { equitySchedule } = result;
    if (equitySchedule.length <= 60) return equitySchedule;
    const step = Math.ceil(equitySchedule.length / 60);
    return equitySchedule.filter((_, i) => i % step === 0 || i === equitySchedule.length - 1);
  }, [result]);

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Placeholder notice */}
      <div className="border-3 border-foreground bg-accent/30 p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] flex items-start gap-3">
        <Info className="h-5 w-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-mono text-sm font-bold">Coming Soon — Not Yet Available</p>
          <p className="text-xs text-muted-foreground mt-1">
            Rent-to-Own is a planned Shelterflex product. This calculator lets
            you explore how it would work for you. No rent-to-own deals can be
            booked today — we will notify you when the product launches.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:gap-8 lg:grid-cols-2">
        {/* ── Inputs ── */}
        <div className="space-y-6">
          <div className="border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
            <h2 className="mb-5 font-mono text-lg font-bold">Your Details</h2>

            {/* Property Price */}
            <div className="mb-6">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-mono text-xs font-bold sm:text-sm">
                  Property Price
                </p>
                <span className="border-2 border-foreground bg-muted px-2 py-1 font-mono text-base font-black sm:px-3 sm:text-lg">
                  {formatFull(propertyPrice)}
                </span>
              </div>
              <Slider
                value={[propertyPrice]}
                onValueChange={([v]) => setPropertyPrice(v)}
                min={2_000_000}
                max={200_000_000}
                step={1_000_000}
                className="py-4"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>₦2M</span>
                <span>₦200M</span>
              </div>
            </div>

            {/* Deposit % */}
            <div className="mb-6">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-mono text-xs font-bold sm:text-sm">
                  Deposit Percentage
                </p>
                <span className="border-2 border-foreground bg-muted px-2 py-1 font-mono text-base font-black sm:px-3 sm:text-lg">
                  {depositPct}% — {formatFull(propertyPrice * depositPct / 100)}
                </span>
              </div>
              <Slider
                value={[depositPct]}
                onValueChange={([v]) => setDepositPct(v)}
                min={10}
                max={50}
                step={5}
                className="py-4"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>10%</span>
                <span>50%</span>
              </div>
            </div>

            {/* Monthly Budget */}
            <div className="mb-6">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-mono text-xs font-bold sm:text-sm">
                  Monthly Budget
                </p>
                <span className="border-2 border-foreground bg-muted px-2 py-1 font-mono text-base font-black sm:px-3 sm:text-lg">
                  {formatFull(monthlyBudget)}
                </span>
              </div>
              <Slider
                value={[monthlyBudget]}
                onValueChange={([v]) => setMonthlyBudget(v)}
                min={50_000}
                max={5_000_000}
                step={10_000}
                className="py-4"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>₦50K</span>
                <span>₦5M</span>
              </div>
            </div>

            {/* Ownership Horizon */}
            <div>
              <p className="mb-4 font-mono text-xs font-bold sm:text-sm">
                Target Ownership Horizon
              </p>
              <div className="grid grid-cols-4 gap-2 sm:gap-3">
                {[5, 10, 15, 20].map((y) => (
                  <button
                    key={y}
                    onClick={() => setOwnershipYears(y)}
                    className={`border-3 border-foreground p-3 font-mono text-sm font-bold transition-all ${
                      ownershipYears === y
                        ? "bg-primary text-primary-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                        : "bg-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                    }`}
                  >
                    {y}yr
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Assumptions box */}
          <div className="border-3 border-foreground bg-muted p-4">
            <p className="font-mono text-xs font-bold uppercase mb-2">
              Calculation Assumptions
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                • Annual interest rate:{" "}
                <strong>{(ANNUAL_INTEREST_RATE * 100).toFixed(0)}%</strong>{" "}
                (amortising)
              </li>
              <li>
                • Estimated rental yield:{" "}
                <strong>{(ESTIMATED_RENTAL_YIELD * 100).toFixed(0)}%</strong>{" "}
                of property value p.a.
              </li>
              <li>• Pure frontend estimate — no API call involved</li>
              <li>
                • Does not include agency fees, legal charges, or maintenance
              </li>
            </ul>
          </div>

          {/* Budget warning outside card */}
          {!result.canAfford && (
            <div className="border-3 border-destructive bg-destructive/10 p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
              <div>
                <p className="font-mono text-sm font-bold text-destructive">
                  Minimum required: {formatFull(result.requiredMonthlyPayment)}/mo
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Your ₦{(monthlyBudget / 1000).toFixed(0)}K budget is{" "}
                  {formatFull(result.requiredMonthlyPayment - monthlyBudget)} short.
                  Try raising your budget, increasing your deposit, or extending
                  the ownership timeline.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Plan Card ── */}
        <RentToOwnPlanCard result={result} propertyPrice={propertyPrice} />
      </div>

      {/* ── Equity Chart ── */}
      <EquityProgressChart data={chartData} propertyPrice={propertyPrice} />
    </div>
  );
}
