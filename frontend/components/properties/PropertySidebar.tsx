"use client"

import Link from "next/link"
import {
  Calculator,
  Star,
  CheckCircle,
  Flag,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import PropertyPriceBreakdown from "@/components/properties/PropertyPriceBreakdown"
import { LandlordSnippet } from "@/components/properties/LandlordSnippet"
import type { LandlordProfile } from "@/components/properties/LandlordSnippet"

interface WhistleblowerProfile {
  name: string
  rating: number
  reviews: number
  bio: string
}

interface PropertySidebarProps {
  price: number
  outrightPriceNgn?: number | null
  installmentBasePriceNgn?: number | null
  paymentMonths: number
  onPaymentMonthsChange: (months: number) => void
  isAuthenticated: boolean
  verificationStatus: string
  landlord: LandlordProfile
  whistleblower: WhistleblowerProfile | null
}

const formatPrice = (price: number) => {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(price)
}

export function PropertySidebar({
  price,
  outrightPriceNgn,
  installmentBasePriceNgn,
  paymentMonths,
  onPaymentMonthsChange,
  isAuthenticated,
  verificationStatus,
  landlord,
  whistleblower,
}: PropertySidebarProps) {
  const installmentPrice = installmentBasePriceNgn ?? price
  const outrightPrice = outrightPriceNgn ?? price
  const minDeposit = installmentPrice * 0.2
  const amountToFinance = installmentPrice - minDeposit
  const inspectionFee = amountToFinance * 0.075
  const monthlyPayment = Math.round(
    (amountToFinance + inspectionFee) / paymentMonths
  )

  return (
    <div className="sticky top-24 space-y-6">
      <div className="border-3 border-foreground bg-card p-4 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] sm:p-6">
        {outrightPriceNgn && installmentBasePriceNgn ? (
          <div className="mb-4 space-y-2">
            <div>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Installment Price
              </p>
              <p className="font-mono text-xl font-black sm:text-2xl">
                {formatPrice(installmentBasePriceNgn)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">
                or{" "}
                <span className="font-mono font-bold text-secondary">
                  {formatPrice(outrightPriceNgn)}
                </span>{" "}
                outright
              </p>
            </div>
          </div>
        ) : (
          <div className="mb-4">
            <p className="text-xs text-muted-foreground sm:text-sm">
              Annual Rent
            </p>
            <p className="font-mono text-2xl font-black sm:text-3xl">
              {formatPrice(price)}
            </p>
          </div>
        )}

        <div className="border-t-3 border-dashed border-foreground/30 pt-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="h-5 w-5 text-primary" />
            <span className="font-mono font-bold">Pay with Shelterflex</span>
          </div>

          <div className="mb-4">
            <p className="block text-sm font-medium mb-2">
              Payment Duration
            </p>
            <div className="flex gap-2">
              {[3, 6, 12].map((months) => (
                <button
                  key={months}
                  onClick={() => onPaymentMonthsChange(months)}
                  className={`flex-1 border-2 border-foreground py-2 text-sm font-bold transition-all ${
                    paymentMonths === months
                      ? "bg-primary text-foreground"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {months}mo
                </button>
              ))}
            </div>
          </div>

          <div className="border-3 border-primary bg-primary/10 p-4">
            <p className="text-sm text-muted-foreground">
              Monthly Payment
            </p>
            <p className="font-mono text-2xl font-black text-primary">
              {formatPrice(monthlyPayment)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              for {paymentMonths} months (after 20% deposit)
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              *excludes inspection fee &amp; other charges
            </p>
          </div>
        </div>

        <PropertyPriceBreakdown
          outrightPriceNgn={outrightPriceNgn}
          installmentBasePriceNgn={installmentBasePriceNgn}
          annualRentNgn={price}
          paymentMonths={paymentMonths}
        />

        {verificationStatus === "VERIFIED" ? (
          isAuthenticated ? (
            <div className="space-y-2">
              <Link href={`/calculator?amount=${installmentPrice}`}>
                <Button className="w-full border-3 border-foreground bg-primary py-6 font-mono text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                  Apply Now
                </Button>
              </Link>
              <p className="text-center text-[11px] text-muted-foreground">
                Equity shown here is an estimate. Once a deal is live, accumulated equity is confirmed on-chain.
              </p>
            </div>
          ) : (
            <Link href="/login">
              <Button className="w-full border-3 border-foreground bg-primary py-6 font-mono text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                Login to Apply
              </Button>
            </Link>
          )
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-full">
                  <Button
                    disabled
                    className="w-full border-3 border-foreground bg-muted py-6 font-mono text-lg font-bold opacity-60 cursor-not-allowed"
                  >
                    Apply Now
                  </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent className="border-2 border-foreground bg-background p-3 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <p className="font-mono text-xs font-bold">
                  {verificationStatus === "PENDING"
                    ? "Booking is gated while property verification is pending."
                    : "This property was rejected during verification and cannot be booked."}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <p className="text-center text-xs text-muted-foreground mt-3">
          Get instant approval in minutes
        </p>
      </div>

      {whistleblower && (
        <div className="border-3 border-secondary bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono font-bold">
              Reported by Resident
            </h3>
            <span className="inline-flex items-center gap-1 border-2 border-secondary bg-secondary/20 px-2 py-1 text-xs font-bold text-secondary">
              <CheckCircle className="h-3 w-3" /> Verified
            </span>
          </div>

          <div className="mb-4">
            <p className="text-lg font-bold">{whistleblower.name}</p>
            <div className="flex items-center gap-1 mt-1">
              <Star className="h-4 w-4 fill-secondary text-secondary" />
              <span className="font-bold">{whistleblower.rating}</span>
              <span className="text-xs text-muted-foreground">
                ({whistleblower.reviews} reviews)
              </span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            {whistleblower.bio}
          </p>

          <div className="bg-secondary/10 border-2 border-secondary p-3 rounded-sm">
            <p className="text-xs font-bold text-secondary mb-1">
              Why this matters:
            </p>
            <p className="text-xs text-muted-foreground">
              Get authentic information from someone who actually
              lives in the building. Ask questions and get honest
              answers about neighborhood life.
            </p>
          </div>
        </div>
      )}

      <LandlordSnippet landlord={landlord} />
    </div>
  )
}
