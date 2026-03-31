"use client";

import type { ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Shield,
  Zap,
  TrendingUp,
  Building,
  Banknote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  landlordBenefits,
  landlordStats,
  landlordTestimonials,
} from "@/lib/mockData";

const iconMap: Record<string, ReactNode> = {
  "Get Paid Upfront": <Banknote className="h-10 w-10" />,
  "Zero Default Risk": <Shield className="h-10 w-10" />,
  "Verified Tenants": <Check className="h-10 w-10" />,
  "Fill Vacancies Faster": <TrendingUp className="h-10 w-10" />,
  "Quick Onboarding": <Zap className="h-10 w-10" />,
  "Property Management": <Building className="h-10 w-10" />,
};

export default function LandlordsPage() {
  return (
    <main className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="border-b-3 border-foreground bg-secondary/30 py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="grid gap-12 lg:grid-cols-2 items-center">
            <div className="space-y-6">
              <span className="inline-block border-3 border-foreground bg-accent px-4 py-2 font-mono text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                FOR LANDLORDS
              </span>
              <h1 className="font-mono text-4xl font-black leading-tight md:text-5xl lg:text-6xl text-balance">
                Get Your Full Rent{" "}
                <span className="text-primary">Upfront.</span>
              </h1>
              <p className="text-lg text-muted-foreground md:text-xl max-w-lg leading-relaxed">
                Stop waiting for monthly payments. Partner with Shelterflex and
                receive your annual rent within 48 hours of tenant move-in.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button
                  onClick={() =>
                    document
                      .getElementById("partner-form")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="border-3 border-foreground bg-primary px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  Become a Partner
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    document
                      .getElementById("how-it-works")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="border-3 border-foreground bg-background px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  How It Works
                </Button>
              </div>
            </div>

            <div className="relative">
              <div className="border-3 border-foreground bg-card p-8 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
                <div className="mb-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Your potential earnings
                  </p>
                  <p className="font-mono text-5xl font-black text-primary">
                    ₦3.6M
                  </p>
                  <p className="text-sm text-muted-foreground">
                    per property annually
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <Check className="h-5 w-5 text-secondary" />
                    <span>Payment in 48 hours</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Check className="h-5 w-5 text-secondary" />
                    <span>No commission fees</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Check className="h-5 w-5 text-secondary" />
                    <span>Verified tenants only</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Check className="h-5 w-5 text-secondary" />
                    <span>Zero default risk</span>
                  </div>
                </div>
              </div>
              <div className="absolute -right-4 -top-4 h-16 w-16 border-3 border-foreground bg-primary" />
              <div className="absolute -bottom-4 -left-4 h-12 w-12 border-3 border-foreground bg-accent" />
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b-3 border-foreground bg-foreground py-8">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {landlordStats.map((stat) => (
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

      {/* Benefits */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <span className="mb-4 inline-block border-3 border-foreground bg-secondary px-4 py-2 font-mono text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              BENEFITS
            </span>
            <h2 className="font-mono text-3xl font-black md:text-5xl text-balance">
              Why Landlords Love Us
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {landlordBenefits.map((benefit, i) => {
              let bgClass = "bg-accent/20";
              if (i % 3 === 0) bgClass = "bg-primary/10";
              else if (i % 3 === 1) bgClass = "bg-secondary/20";

              return (
                <div
                  key={benefit.title}
                  className={`border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] ${bgClass}`}
                >
                  <div className="mb-4 text-foreground">
                    {iconMap[benefit.title]}
                  </div>
                  <h3 className="mb-2 font-mono text-xl font-bold">
                    {benefit.title}
                  </h3>
                  <p className="text-muted-foreground">{benefit.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section
        id="how-it-works"
        className="border-y-3 border-foreground bg-muted py-16 md:py-24"
      >
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <span className="mb-4 inline-block border-3 border-foreground bg-accent px-4 py-2 font-mono text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              HOW IT WORKS
            </span>
            <h2 className="font-mono text-3xl font-black md:text-5xl text-balance">
              Simple Process for Landlords
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-4">
            {[
              {
                step: "01",
                title: "Sign Up",
                desc: "Register as a partner landlord in under 5 minutes.",
              },
              {
                step: "02",
                title: "List Property",
                desc: "Add your property details and set your annual rent.",
              },
              {
                step: "03",
                title: "We Find Tenants",
                desc: "We match you with verified, creditworthy tenants.",
              },
              {
                step: "04",
                title: "Get Paid",
                desc: "Receive full annual rent within 48 hours of move-in.",
              },
            ].map((item, i) => (
              <div
                key={item.step}
                className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              >
                <span
                  className={`mb-4 inline-block font-mono text-5xl font-black ${i % 2 === 0 ? "text-primary" : "text-secondary"}`}
                >
                  {item.step}
                </span>
                <h3 className="mb-2 font-mono text-xl font-bold">
                  {item.title}
                </h3>
                <p className="text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <h2 className="font-mono text-3xl font-black md:text-4xl">
              What Our Partners Say
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto">
            {landlordTestimonials.map((testimonial) => (
              <div
                key={testimonial.name}
                className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              >
                <p className="mb-6 text-lg italic leading-relaxed">
                  "{testimonial.quote}"
                </p>
                <div>
                  <p className="font-mono font-bold">{testimonial.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {testimonial.role}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Partner Form */}
      <section
        id="partner-form"
        className="border-t-3 border-foreground bg-primary py-16 md:py-24"
      >
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-2xl">
            <div className="mb-8 text-center">
              <h2 className="mb-4 font-mono text-3xl font-black text-primary-foreground md:text-4xl">
                Become a Partner Landlord
              </h2>
              <p className="text-primary-foreground/80">
                Fill out the form below and our team will reach out within 24
                hours.
              </p>
            </div>

            <form className="border-3 border-foreground bg-background p-8 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    Full Name
                  </p>
                  <Input
                    id="partner-full-name"
                    type="text"
                    placeholder="Enter your name"
                    className="border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  />
                </div>
                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    Phone Number
                  </p>
                  <Input
                    id="partner-phone-number"
                    type="tel"
                    placeholder="08X XXX XXXX"
                    className="border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  />
                </div>
                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    Email Address
                  </p>
                  <Input
                    id="partner-email"
                    type="email"
                    placeholder="you@shelterflex.com"
                    className="border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  />
                </div>
                <div>
                  <p className="mb-2 block font-mono text-sm font-bold">
                    Number of Properties
                  </p>
                  <Input
                    id="partner-property-count"
                    type="number"
                    placeholder="e.g. 5"
                    className="border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  />
                </div>
              </div>
              <div className="mt-6">
                <p className="mb-2 block font-mono text-sm font-bold">
                  Property Location(s)
                </p>
                <Input
                  id="partner-property-locations"
                  type="text"
                  placeholder="e.g. Lekki, Lagos"
                  className="border-3 border-foreground py-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus:translate-x-0.5 focus:translate-y-0.5 focus:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                />
              </div>
              <Button
                type="submit"
                className="mt-8 w-full border-3 border-foreground bg-primary px-8 py-6 text-lg font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                Submit Application
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
