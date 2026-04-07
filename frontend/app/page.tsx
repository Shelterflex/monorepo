"use client";

import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Home,
  Shield,
  Clock,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { homePageStats, homePageBenefits } from "@/lib/mockData";

const iconMap = {
  Wallet,
  Clock,
  Shield,
  Home,
};

export default function HomePage() {
  return (
    <main>
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-background py-12 sm:py-16 md:py-20 lg:py-24">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-12 items-center">
            <div className="space-y-6 sm:space-y-8">
              <div className="inline-flex items-center gap-2 border-3 border-foreground bg-accent px-3 py-1.5 sm:px-4 sm:py-2 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <span className="font-mono text-xs sm:text-sm font-bold">NEW</span>
                <span className="text-xs sm:text-sm">
                  Now available in Lagos, Abuja & Port Harcourt
                </span>
              </div>

              <h1 className="font-mono text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-black leading-tight text-balance">
                Rent Now,
                <br />
                <span className="text-primary">Pay Later.</span>
              </h1>

              <p className="text-base sm:text-lg md:text-xl max-w-lg leading-relaxed text-muted-foreground">
                Stop stressing about annual rent payments. Shelterflex helps you
                split your rent into affordable monthly installments.
              </p>

              <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                <Link href="/properties">
                  <Button className="border-3 border-foreground bg-primary px-6 py-4 sm:px-8 sm:py-6 text-base sm:text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] min-h-12 w-full sm:w-auto">
                    Find a Home
                    <ArrowRight className="ml-2 h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                </Link>
                <Link href="/calculator">
                  <Button
                    variant="outline"
                    className="border-3 border-foreground bg-background px-6 py-4 sm:px-8 sm:py-6 text-base sm:text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] min-h-12 w-full sm:w-auto"
                  >
                    Calculate Payments
                  </Button>
                </Link>
              </div>

              <div className="flex items-center gap-3 pt-4 sm:pt-6">
                <div className="flex -space-x-2 sm:-space-x-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-8 w-8 sm:h-10 sm:w-10 rounded-full border-3 border-foreground bg-secondary"
                    />
                  ))}
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  <span className="font-bold text-foreground">2,400+</span>{" "}
                  tenants joined this month
                </p>
              </div>
            </div>

            <div className="relative">
              <div className="border-3 border-foreground bg-card p-6 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-sm font-bold text-muted-foreground">
                    PAYMENT PREVIEW
                  </span>
                  <span className="border-2 border-foreground bg-secondary px-2 py-1 text-xs font-bold">
                    SAMPLE
                  </span>
                </div>
                <div className="space-y-4">
                  <div className="border-b-2 border-dashed border-foreground/30 pb-4">
                    <p className="text-sm text-muted-foreground">Annual Rent</p>
                    <p className="font-mono text-3xl font-black">₦2,400,000</p>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <ChevronRight className="h-4 w-4" />
                    <span>Split into 12 monthly payments</span>
                  </div>
                  <div className="border-3 border-foreground bg-primary/10 p-4">
                    <p className="text-sm text-muted-foreground">
                      You pay monthly
                    </p>
                    <p className="font-mono text-4xl font-black text-primary">
                      ₦215,000
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      *excludes inspection fee + 20% deposit
                    </p>
                  </div>
                </div>
              </div>

              <div className="absolute -right-4 -top-4 h-16 w-16 border-3 border-foreground bg-accent" />
              <div className="absolute -bottom-4 -left-4 h-12 w-12 border-3 border-foreground bg-secondary" />
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="border-y-3 border-foreground bg-foreground py-6">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {homePageStats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="font-mono text-2xl font-black text-background md:text-3xl">
                  {stat.value}
                </p>
                <p className="text-sm text-background/70">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-muted py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <span className="mb-4 inline-block border-3 border-foreground bg-accent px-4 py-2 font-mono text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              HOW IT WORKS
            </span>
            <h2 className="font-mono text-3xl font-black md:text-5xl text-balance">
              Get Your Dream Home in 4 Simple Steps
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                step: "01",
                title: "Browse Properties",
                desc: "Explore verified rental listings in your preferred location.",
              },
              {
                step: "02",
                title: "Apply Online",
                desc: "Submit your application with basic documents in minutes.",
              },
              {
                step: "03",
                title: "Get Approved",
                desc: "Receive approval within 24 hours of application.",
              },
              {
                step: "04",
                title: "Move In",
                desc: "Pay your first installment and get your keys.",
              },
            ].map((item, i) => {
              let stepColorClass = "text-secondary";
              if (i % 2 === 0) stepColorClass = "text-primary";

              return (
                <div
                  key={item.step}
                  className="group border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  <span
                    className={`mb-4 inline-block font-mono text-5xl font-black ${stepColorClass}`}
                  >
                    {item.step}
                  </span>
                  <h3 className="mb-2 font-mono text-xl font-bold">
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="grid gap-12 lg:grid-cols-2 items-center">
            <div>
              <span className="mb-4 inline-block border-3 border-foreground bg-secondary px-4 py-2 font-mono text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                WHY SHELTERFLEX
              </span>
              <h2 className="mb-6 font-mono text-3xl font-black md:text-5xl text-balance">
                Renting Made <span className="text-primary">Stress-Free</span>
              </h2>
              <p className="mb-8 text-lg text-muted-foreground leading-relaxed">
                We understand that coming up with a full year rent upfront is
                challenging. That is why we created a solution that works for
                everyone.
              </p>

              <div className="space-y-4">
                {[
                  "No collateral required",
                  "Flexible payment terms",
                  "Build your credit score",
                  "24/7 customer support",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center border-3 border-foreground bg-secondary">
                      <Check className="h-4 w-4" />
                    </div>
                    <span className="font-medium">{item}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <Link href="/about">
                  <Button className="border-3 border-foreground bg-primary px-6 py-4 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                    Learn More About Us
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {homePageBenefits.map((benefit, i) => {
                const iconKey = Object.keys(iconMap)[
                  i % 4
                ] as keyof typeof iconMap;
                const Icon = iconMap[iconKey];
                let bgClass = "bg-card";
                if (i === 0) bgClass = "bg-primary/10";
                else if (i === 1) bgClass = "bg-secondary/30";
                else if (i === 2) bgClass = "bg-accent/30";
                return (
                  <div
                    key={benefit.title}
                    className={`border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${bgClass}`}
                  >
                    <Icon className="mb-4 h-8 w-8" />
                    <h3 className="mb-2 font-mono text-lg font-bold">
                      {benefit.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {benefit.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-y-3 border-foreground bg-primary py-16 md:py-24">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-6 font-mono text-3xl font-black text-primary-foreground md:text-5xl text-balance">
            Ready to Find Your New Home?
          </h2>
          <p className="mb-8 text-lg text-primary-foreground/80 max-w-2xl mx-auto leading-relaxed">
            Join thousands of Nigerians who have made the smart choice. Start
            your journey to stress-free renting today.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/signup">
              <Button className="border-3 border-foreground bg-background px-8 py-6 text-lg font-bold text-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/landlords">
              <Button
                variant="outline"
                className="border-3 border-foreground bg-transparent px-8 py-6 text-lg font-bold text-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:bg-background/10"
              >
                I am a Landlord
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
