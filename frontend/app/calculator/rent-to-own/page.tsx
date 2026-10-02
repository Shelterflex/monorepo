import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import RentToOwnCalculator from "@/components/calculator/RentToOwnCalculator";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Rent-to-Own Calculator",
  description:
    "Explore how the Shelterflex rent-to-own programme could help you build equity toward owning your home.",
  path: "/calculator/rent-to-own",
});

export default function RentToOwnPage() {
  return (
    <main id="main-content" className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b-3 border-foreground bg-muted py-8 md:py-12 lg:py-16">
        <div className="container mx-auto px-4">
          <Link
            href="/calculator"
            className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Payment Calculator
          </Link>

          <div className="flex flex-wrap items-start gap-3 mb-3">
            <h1 className="font-mono text-2xl font-black md:text-4xl lg:text-5xl">
              Rent-to-Own{" "}
              <span className="text-primary">Equity Calculator</span>
            </h1>
            <span className="self-start mt-1 border-3 border-foreground bg-secondary/20 px-2 py-0.5 font-mono text-xs font-bold uppercase shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
              Coming Soon
            </span>
          </div>

          <p className="text-sm text-muted-foreground max-w-2xl md:text-base lg:text-lg">
            See how monthly payments build real ownership equity instead of just
            paying rent. This is a preview of our upcoming rent-to-own product —
            not yet available for booking.
          </p>
        </div>
      </section>

      {/* Calculator */}
      <section className="py-8 md:py-12 lg:py-16">
        <div className="container mx-auto px-4">
          <RentToOwnCalculator />
        </div>
      </section>

      {/* Footer CTA */}
      <section className="border-t-3 border-foreground bg-muted py-10 md:py-14">
        <div className="container mx-auto px-4 text-center">
          <p className="font-mono text-sm font-bold mb-1">
            Interested in rent-to-own?
          </p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto mb-4">
            We are building this product now. Register your interest and we will
            reach out when it launches.
          </p>
          <Link
            href="/signup"
            className="inline-block border-3 border-foreground bg-primary px-6 py-3 font-mono text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
          >
            Create an Account
          </Link>
        </div>
      </section>
    </main>
  );
}
