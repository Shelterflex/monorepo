"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

interface FrozenAccountBannerProps {
  freezeReason?: string | null;
  deficit: number;
  ctaHref?: string;
  ctaLabel?: string;
}

function formatNgn(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount);
}

export default function FrozenAccountBanner({
  freezeReason,
  deficit,
  ctaHref = "/wallet",
  ctaLabel = "Top up wallet",
}: FrozenAccountBannerProps) {
  return (
    <div className="rounded-md border-2 border-destructive/50 bg-destructive/10 p-4 md:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="text-base font-bold md:text-lg">Account frozen</p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-destructive">
            A payment reversal caused a negative balance. Please top up to continue using staking and withdrawals.
          </p>
          {deficit > 0 ? (
            <p className="mt-2 text-sm font-semibold text-destructive">
              Outstanding deficit: {formatNgn(deficit)}
            </p>
          ) : null}
          {freezeReason ? (
            <p className="mt-1 break-words text-xs text-destructive/90">Reason: {freezeReason}</p>
          ) : null}
        </div>
        <Button
          asChild
          className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] sm:w-auto"
        >
          <Link href={ctaHref}>{ctaLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
