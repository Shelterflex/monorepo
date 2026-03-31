"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  MapPin,
  Bed,
  Bath,
  Square,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { DashboardHeader } from "@/components/dashboard-header"
import { tenantApplicationProperties as properties } from "@/lib/mockData"

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(value)
}

export default function TenantApplicationPage() {
  const searchParams = useSearchParams()
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [hasAgreed, setHasAgreed] = useState(false)

  const annualRent = Number(searchParams.get("amount")) || 2400000
  const deposit = Number(searchParams.get("deposit")) || annualRent * 0.2
  const duration = Number(searchParams.get("duration")) || 12
  const propertyId = Number(searchParams.get("propertyId")) || 1

  const applicationId = `#APP-2025-${propertyId}-${duration}-${deposit}-${annualRent}`

  const property = properties.find((p) => p.id === propertyId)
  const totalAmount = annualRent - deposit
  const monthlyPayment = totalAmount / duration

  if (isConfirmed) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />

        <main className="min-h-screen pt-20 lg:ml-64">
          <div className="p-4 md:p-6 lg:p-8">
            <div className="mx-auto max-w-2xl">
              {/* Success Message */}
              <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <div className="mb-6 flex items-center justify-center">
                  <div className="flex h-20 w-20 items-center justify-center border-3 border-foreground bg-secondary">
                    <CheckCircle className="h-10 w-10" />
                  </div>
                </div>

                <h1 className="mb-2 text-center font-mono text-2xl font-black md:text-3xl">
                  Application Submitted!
                </h1>

                <p className="mb-6 text-center text-muted-foreground">
                  Your application has been successfully submitted. Our team will review it and contact you
                  within 24-48 hours with next steps.
                </p>

                <div className="mb-8 border-2 border-dashed border-foreground/30 p-4 text-sm">
                  <p className="mb-3 font-bold">Application Details:</p>
                  <div className="space-y-2 text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Application ID:</span>
                      <span className="font-mono font-bold">{applicationId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Monthly Payment:</span>
                      <span className="font-mono font-bold">{formatCurrency(monthlyPayment)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Duration:</span>
                      <span className="font-mono font-bold">{duration} months</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 md:flex-row">
                  <Link href="/dashboard/tenant" className="flex-1">
                    <Button className="w-full border-3 border-foreground bg-primary py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                      Back to Dashboard
                    </Button>
                  </Link>
                  <Link href="/properties" className="flex-1">
                    <Button className="w-full border-3 border-foreground bg-secondary py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                      Browse More Properties
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <main className="min-h-screen pt-20 lg:ml-64">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-2xl">
            {/* Back Button */}
            <Link href={`/calculator?amount=${annualRent}`}>
              <button className="mb-6 flex items-center gap-2 border-3 border-foreground bg-card px-4 py-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                <ArrowLeft className="h-5 w-5" />
                Back to Calculator
              </button>
            </Link>

            {/* Application Summary */}
            <div className="border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
              <h1 className="mb-2 font-mono text-2xl font-black md:text-3xl">Application Summary</h1>
              <p className="text-muted-foreground">Review your details before confirming your application</p>
            </div>

            {/* Property Card */}
            <div className="mt-6 border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
              <h2 className="mb-4 font-mono text-lg font-bold">Property Details</h2>

              <div className="mb-6 space-y-3">
                <div>
                  <h3 className="font-bold text-foreground">{property?.title}</h3>
                  <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" />
                    {property?.location}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-1 border-2 border-foreground/30 bg-muted/50 px-2 py-1">
                    <Bed className="h-4 w-4" />
                    <span className="text-sm font-bold">{property?.beds}</span>
                  </div>
                  <div className="flex items-center gap-1 border-2 border-foreground/30 bg-muted/50 px-2 py-1">
                    <Bath className="h-4 w-4" />
                    <span className="text-sm font-bold">{property?.baths}</span>
                  </div>
                  <div className="flex items-center gap-1 border-2 border-foreground/30 bg-muted/50 px-2 py-1">
                    <Square className="h-4 w-4" />
                    <span className="text-sm font-bold">{property?.sqm} m²</span>
                  </div>
                </div>
              </div>

              {/* Payment Breakdown */}
              <div className="border-t-2 border-foreground/20 pt-6">
                <h3 className="mb-4 font-mono font-bold">Payment Breakdown</h3>

                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-foreground/10 pb-2">
                    <span className="text-muted-foreground">Annual Rent</span>
                    <span className="font-mono font-bold">{formatCurrency(annualRent)}</span>
                  </div>

                  <div className="flex items-center justify-between border-b border-foreground/10 pb-2">
                    <span className="text-muted-foreground">Your Deposit (Upfront)</span>
                    <span className="font-mono font-bold text-secondary">-{formatCurrency(deposit)}</span>
                  </div>

                  <div className="flex items-center justify-between border-b-2 border-foreground pb-2">
                    <span className="font-bold">Amount to Finance</span>
                    <span className="font-mono text-lg font-black">{formatCurrency(totalAmount)}</span>
                  </div>

                  <div className="mt-4 bg-primary/10 p-4">
                    <p className="mb-1 text-xs text-muted-foreground">Monthly Payment</p>
                    <p className="font-mono text-2xl font-black text-primary">{formatCurrency(monthlyPayment)}</p>
                    <p className="mt-2 text-xs text-muted-foreground">for {duration} months</p>
                  </div>
                </div>
              </div>

              {/* Important Note */}
              <div className="mt-6 border-l-4 border-accent bg-accent/5 p-4">
                <div className="flex gap-3">
                  <AlertCircle className="h-5 w-5 shrink-0 text-accent mt-0.5" />
                  <div className="text-sm">
                    <p className="font-bold mb-1">Additional Fees Required</p>
                    <p className="text-muted-foreground">
                      You will need to pay inspection fee, agreement fee, and commission separately. These are not included in the monthly payments shown above.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Terms & Conditions */}
            <div className="mt-6 border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:p-6">
              <h2 className="mb-4 font-mono text-lg font-bold">Terms & Conditions</h2>

              <div className="mb-4 max-h-40 overflow-y-auto space-y-3 border-2 border-foreground/20 bg-muted/30 p-4 text-xs text-muted-foreground md:text-sm">
                <p>
                  <strong>1. Rent Payment:</strong> You agree to pay the monthly installment on or before the due date. Late payments may result in additional fees.
                </p>
                <p>
                  <strong>2. Property Terms:</strong> The lease agreement with the landlord remains between you and the landlord. Shelterflex is financing only.
                </p>
                <p>
                  <strong>3. Deposit:</strong> Your deposit serves as a security measure for Shelterflex. It will NOT be refunded to you. The deposit is renewed annually to demonstrate your commitment to retaining the property. Minimum deposit is 20% of the yearly rent.
                </p>
                <p>
                  <strong>4. Default:</strong> Failure to pay may result in legal action and affect your credit record.
                </p>
                <p>
                  <strong>5. Early Settlement:</strong> You may settle the remaining balance early without penalty.
                </p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasAgreed}
                  onChange={(e) => setHasAgreed(e.target.checked)}
                  className="mt-1 h-5 w-5 border-2 border-foreground cursor-pointer"
                />
                <span className="text-sm text-foreground">
                  I have read and agree to the{" "}
                  <Link href="/terms-of-service" className="font-bold border-b-2 border-foreground hover:text-primary">
                    terms and conditions
                  </Link>
                </span>
              </label>
            </div>

            {/* Action Buttons */}
            <div className="mt-6 flex flex-col gap-3 md:flex-row">
              <Link href={`/calculator?amount=${annualRent}`} className="flex-1">
                <Button className="w-full border-3 border-foreground bg-card py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                  <ArrowLeft className="mr-2 h-5 w-5" />
                  Go Back
                </Button>
              </Link>

              <button
                onClick={() => setIsConfirmed(true)}
                disabled={!hasAgreed}
                className="flex-1 border-3 border-foreground bg-primary py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm Application
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
