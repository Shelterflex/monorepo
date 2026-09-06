"use client";

import { TrendingUp, Home, CalendarClock, AlertCircle } from "lucide-react";
import type { RentToOwnResult } from "@/lib/rentToOwnCalc";
import { formatNgn } from "@/lib/currency";
import { formatDate } from "@/lib/date";

interface Props {
  result: RentToOwnResult;
  propertyPrice: number;
}

export default function RentToOwnPlanCard({ result, propertyPrice }: Props) {
  const {
    deposit,
    requiredMonthlyPayment,
    totalMonths,
    totalInterest,
    totalCostRTO,
    totalCostRent,
    monthlyRentEquivalent,
    ownershipDate,
    canAfford,
  } = result;

  const ownershipDateStr = formatDate(ownershipDate, {
    month: "long",
    year: "numeric",
  });

  // How much equity portion vs rent portion per month
  const equityPortion = requiredMonthlyPayment - monthlyRentEquivalent;
  const isEquityPositive = equityPortion > 0;

  // Net advantage: property value minus extra interest paid vs renting
  const netAdvantage = propertyPrice - (totalCostRTO - totalCostRent);

  return (
    <div className="border-3 border-foreground bg-card shadow-[8px_8px_0px_0px_rgba(26,26,26,1)] overflow-hidden">
      {/* Header */}
      <div className="bg-primary px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <Home className="h-5 w-5 text-primary-foreground" />
          <h2 className="font-mono text-base font-black text-primary-foreground uppercase tracking-tight">
            Rent-to-Own Plan
          </h2>
        </div>
        <p className="mt-0.5 font-mono text-xs text-primary-foreground/80">
          Projected ownership by {ownershipDateStr}
        </p>
      </div>

      <div className="p-4 md:p-6 space-y-4">
        {/* Monthly breakdown */}
        <div>
          <p className="font-mono text-xs font-bold text-muted-foreground uppercase mb-2">
            Monthly Payment Breakdown
          </p>
          <div className="border-3 border-foreground bg-primary/10 p-4">
            <p className="text-xs text-muted-foreground">Total Monthly Payment</p>
            <p className="font-mono text-3xl md:text-4xl font-black text-primary">
              {formatNgn(requiredMonthlyPayment)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              for {totalMonths} months ({totalMonths / 12} years)
            </p>
          </div>

          <div className="mt-3 space-y-2">
            <div className="flex justify-between items-center border-b border-dashed border-foreground/20 pb-2">
              <span className="text-sm text-muted-foreground">
                Estimated rent component
              </span>
              <span className="font-mono font-bold">
                {formatNgn(monthlyRentEquivalent)}
              </span>
            </div>
            <div className="flex justify-between items-center border-b border-dashed border-foreground/20 pb-2">
              <span className="text-sm text-muted-foreground">
                Equity / principal component
              </span>
              <span
                className={`font-mono font-bold ${
                  isEquityPositive ? "text-secondary" : "text-destructive"
                }`}
              >
                {isEquityPositive ? "+" : ""}
                {formatNgn(equityPortion)}
              </span>
            </div>
            <div className="flex justify-between items-center border-b border-dashed border-foreground/20 pb-2">
              <span className="text-sm text-muted-foreground">
                Initial deposit (upfront)
              </span>
              <span className="font-mono font-bold">{formatNgn(deposit)}</span>
            </div>
            <div className="flex justify-between items-center border-b border-dashed border-foreground/20 pb-2">
              <span className="text-sm text-muted-foreground">
                Total interest paid
              </span>
              <span className="font-mono font-bold text-muted-foreground">
                {formatNgn(totalInterest)}
              </span>
            </div>
          </div>
        </div>

        {/* Comparison */}
        <div className="border-3 border-foreground p-3 md:p-4">
          <p className="font-mono text-xs font-bold uppercase mb-3 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            vs. Standard Renting ({totalMonths / 12} years)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="border-2 border-foreground p-3 bg-primary/5">
              <p className="text-xs text-muted-foreground mb-1">
                Rent-to-Own total cost
              </p>
              <p className="font-mono text-base font-black">{formatNgn(totalCostRTO)}</p>
              <p className="text-xs text-secondary font-bold mt-0.5">
                You own the property
              </p>
            </div>
            <div className="border-2 border-foreground p-3 bg-muted">
              <p className="text-xs text-muted-foreground mb-1">
                Standard rent total cost
              </p>
              <p className="font-mono text-base font-black">{formatNgn(totalCostRent)}</p>
              <p className="text-xs text-destructive font-bold mt-0.5">
                Nothing to show for it
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t-2 border-foreground pt-3">
            <span className="font-mono text-xs font-bold">Net advantage (incl. property value)</span>
            <span className="font-mono font-black text-secondary text-sm">
              {netAdvantage > 0 ? "+" : ""}
              {formatNgn(netAdvantage)}
            </span>
          </div>
        </div>

        {/* Ownership date highlight */}
        <div className="flex items-center gap-3 border-3 border-foreground bg-secondary/10 p-3">
          <CalendarClock className="h-8 w-8 shrink-0 text-secondary" />
          <div>
            <p className="font-mono text-xs text-muted-foreground">
              Projected ownership date
            </p>
            <p className="font-mono font-black text-lg">{ownershipDateStr}</p>
          </div>
        </div>

        {/* Cannot afford warning */}
        {!canAfford && (
          <div className="flex items-start gap-3 border-3 border-destructive bg-destructive/10 p-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div>
              <p className="font-mono text-xs font-bold text-destructive uppercase">
                Budget too low
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your monthly budget is below the required payment of{" "}
                <strong>{formatNgn(requiredMonthlyPayment)}</strong> to reach
                ownership in {totalMonths / 12} years. Increase your budget or
                extend the ownership timeline.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
