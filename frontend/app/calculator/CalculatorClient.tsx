"use client";
"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowRight, Info, Check, AlertCircle, Loader2, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export default function CalculatorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <CalculatorContent />
    </Suspense>
  );
}

function CalculatorContent() {
  const searchParams = useSearchParams();
  const initialAmount = searchParams.get("amount");
  const parsedInitial = initialAmount ? Number.parseInt(initialAmount, 10) : 2400000;

  const [priceMode, setPriceMode] = useState<"installment" | "outright">("installment");
  const [installmentPrice, setInstallmentPrice] = useState(parsedInitial);
  const [outrightPrice, setOutrightPrice] = useState(Math.round(parsedInitial / 1.1));
  const [deposit, setDeposit] = useState(Math.round(parsedInitial * 0.2));
  const [duration, setDuration] = useState(12);
  const scheduleBaseTime = Date.UTC(2025, 0, 1);

  const effectivePrice = priceMode === "outright" ? outrightPrice : installmentPrice;
  const minDeposit = effectivePrice * 0.2;
  const maxDeposit = effectivePrice;
  const totalAmount = effectivePrice - deposit;
  const monthlyPayment = totalAmount / duration;
  const savings = installmentPrice - outrightPrice;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  const paymentSchedule = Array.from({ length: duration }, (_, i) => ({
    month: i + 1,
    amount: monthlyPayment,
    date: new Date(scheduleBaseTime + (i + 1) * 30 * 24 * 60 * 60 * 1000).toLocaleDateString("en-NG", {
      month: "short",
      year: "numeric",
    }),
  }))

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b-3 border-foreground bg-muted py-8 md:py-12 lg:py-16">
        <div className="container mx-auto px-4">
          <h1 className="mb-3 font-mono text-2xl font-black md:mb-4 md:text-4xl lg:text-5xl">
            Payment <span className="text-primary">Calculator</span>
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl md:text-base lg:text-lg">
            See exactly how much you will pay each month. No hidden fees, no surprises.
          </p>

          {/* Rent-to-Own tab */}
          <div className="mt-6 flex gap-3 flex-wrap">
            <span className="border-3 border-foreground bg-primary text-primary-foreground px-4 py-2 font-mono text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              Installment Plan
            </span>
            <Link
              href="/calculator/rent-to-own"
              className="inline-flex items-center gap-2 border-3 border-foreground bg-background px-4 py-2 font-mono text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
            >
              <Home className="h-4 w-4" />
              Rent-to-Own
              <span className="border border-foreground bg-secondary/20 px-1 py-0.5 text-[10px] font-black uppercase">
                Coming Soon
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-8 md:py-12 lg:py-16">
        <div className="container mx-auto px-4">
          <div className="grid gap-6 md:gap-8 lg:grid-cols-2">
            {/* Calculator Inputs */}
            <div className="space-y-6 md:space-y-8">
              <div className="border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
                <h2 className="mb-4 font-mono text-lg font-bold md:mb-6 md:text-xl">Configure Your Plan</h2>

                {/* Price Mode Toggle */}
                <div className="mb-6 flex gap-2">
                  <button
                    onClick={() => setPriceMode("installment")}
                    className={`flex-1 border-3 border-foreground p-3 font-bold text-center transition-all ${
                      priceMode === "installment"
                        ? "bg-primary text-primary-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                        : "bg-background hover:bg-muted"
                    }`}
                  >
                    <p className="text-xs text-muted-foreground">Installment</p>
                    <p className="font-mono text-lg">{formatCurrency(installmentPrice)}</p>
                  </button>
                  <button
                    onClick={() => setPriceMode("outright")}
                    className={`flex-1 border-3 border-foreground p-3 font-bold text-center transition-all ${
                      priceMode === "outright"
                        ? "bg-primary text-primary-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                        : "bg-background hover:bg-muted"
                    }`}
                  >
                    <p className="text-xs text-muted-foreground">Outright (save ₦{formatCurrency(savings).replace("₦", "")})</p>
                    <p className="font-mono text-lg">{formatCurrency(outrightPrice)}</p>
                  </button>
                </div>

                {/* Installment Price Slider */}
                <div className="mb-6 md:mb-8">
                  <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="font-mono text-xs font-bold sm:text-sm">Installment Base Price</p>
                    <span className="border-2 border-foreground bg-muted px-2 py-1 font-mono text-base font-black sm:px-3 sm:text-lg">
                      {formatCurrency(installmentPrice)}
                    </span>
                  </div>
                  <Slider
                    value={[installmentPrice]}
                    onValueChange={(value) => {
                      setInstallmentPrice(value[0]);
                      setOutrightPrice(Math.round(value[0] / 1.1));
                      setDeposit(Math.max(Math.round(value[0] * 0.2), deposit));
                    }}
                    min={500000}
                    max={20000000}
                    step={100000}
                    className="py-4"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>₦500K</span>
                    <span>₦20M</span>
                  </div>
                </div>

                {/* Initial Deposit */}
                <div className="mb-6 md:mb-8">
                  <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="font-mono text-xs font-bold sm:text-sm">Initial Deposit (Min. 20%)</p>
                    <span className="border-2 border-foreground bg-muted px-2 py-1 font-mono text-base font-black sm:px-3 sm:text-lg">
                      {formatCurrency(deposit)}
                    </span>
                  </div>
                  <Slider
                    value={[deposit]}
                    onValueChange={(value) => setDeposit(Math.max(value[0], minDeposit))}
                    min={minDeposit}
                    max={maxDeposit}
                    step={50000}
                    className="py-4"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{formatCurrency(minDeposit)} (20%)</span>
                    <span>{formatCurrency(maxDeposit)} (100% - Pay in Full)</span>
                  </div>
                </div>

                {/* Duration */}
                <div>
                  <p className="mb-4 block font-mono text-sm font-bold">Payment Duration</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[3, 6, 12].map((months) => (
                      <button
                        key={months}
                        onClick={() => setDuration(months)}
                        className={`border-3 border-foreground p-4 font-mono font-bold transition-all ${
                          duration === months
                            ? "bg-primary text-primary-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                            : "bg-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                        }`}
                      >
                        {months} Months
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Info Box */}
              <div className="border-3 border-foreground bg-accent/30 p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <div className="flex gap-4">
                  <Info className="h-6 w-6 shrink-0" />
                  <div>
                    <h3 className="mb-2 font-mono font-bold">How it works</h3>
                    <div className="mb-4 flex items-start gap-2 border-b border-foreground/20 pb-4">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="flex items-center gap-1 text-xs font-bold text-muted-foreground underline decoration-dotted"
                            >
                              Why two prices? <Info className="h-3 w-3" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="border-2 border-foreground bg-background p-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] max-w-xs">
                            <p className="text-xs font-medium">
                              The installment price includes the cost of financing
                              your rent over time. Paying outright costs less
                              because there are no financing charges. Choose what
                              works best for your budget.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <Check className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>We pay your landlord the full annual rent upfront</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>You pay us back in comfortable monthly installments</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>Minimum 20% deposit required, up to 100% if paying in full</span>
                      </li>
                    </ul>
                    <div className="mt-4 flex items-start gap-2 border-t border-foreground/20 pt-4">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">
                        <strong>Note:</strong> Inspection fee, agreement fee, commission and initial deposit are paid separately by you
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Results */}
            <div className="space-y-6">
              {/* Summary Card */}
              <div className="border-3 border-foreground bg-card p-6 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
                <h2 className="mb-6 font-mono text-xl font-bold">Payment Summary</h2>

<div className="space-y-4">
                  <div className="flex items-center justify-between border-b-2 border-dashed border-foreground/30 pb-4">
                    <span className="text-muted-foreground">{priceMode === "outright" ? "Outright Price" : "Installment Price"}</span>
                    <span className="font-mono font-bold">{formatCurrency(effectivePrice)}</span>
                  </div>
                  {priceMode === "outright" && savings > 0 && (
                    <div className="flex items-center justify-between border-b-2 border-dashed border-foreground/30 pb-4 pt-2">
                      <span className="text-muted-foreground">You save</span>
                      <span className="font-mono font-bold text-secondary">{formatCurrency(savings)}</span>
                    </div>
                  )}
                  {deposit > 0 && (
                    <div className="flex items-center justify-between border-b-2 border-dashed border-foreground/30 pb-4">
                      <span className="text-muted-foreground">Your Deposit (paid upfront)</span>
                      <span className="font-mono font-bold text-secondary">-{formatCurrency(deposit)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-b-2 border-foreground pb-4">
                    <span className="font-mono font-bold">Amount We Finance</span>
                    <span className="font-mono text-xl font-black">{formatCurrency(totalAmount)}</span>
                  </div>
                </div>

                <div className="mt-4 border-3 border-foreground bg-primary/10 p-4 md:mt-6 md:p-6">
                  <p className="mb-1 text-xs text-muted-foreground sm:text-sm">Your Monthly Payment</p>
                  <p className="font-mono text-2xl font-black text-primary sm:text-3xl md:text-4xl lg:text-5xl">
                    {formatCurrency(monthlyPayment)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground sm:mt-2 sm:text-sm">for {duration} months</p>
                </div>

                <div className="mt-6">
                  <Link href={`/dashboard/tenant/application?amount=${effectivePrice}&deposit=${deposit}&duration=${duration}&priceMode=${priceMode}`}>
                    <Button className="w-full border-3 border-foreground bg-primary px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                      Apply Now
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Payment Schedule */}
              <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 font-mono text-lg font-bold">Payment Schedule</h3>
                <div className="max-h-64 overflow-y-auto">
                  <div className="space-y-2">
                    {paymentSchedule.map((payment) => (
                      <div
                        key={payment.month}
                        className="flex items-center justify-between border-b border-foreground/10 py-2 last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center border-2 border-foreground bg-muted font-mono text-sm font-bold">
                            {payment.month}
                          </span>
                          <span className="text-sm text-muted-foreground">{payment.date}</span>
                        </div>
                        <span className="font-mono font-bold">{formatCurrency(payment.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
