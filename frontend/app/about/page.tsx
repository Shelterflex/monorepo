"use client"

import Link from "next/link"
import { ArrowRight, Users, Target, Heart, Award } from "lucide-react"
import { Button } from "@/components/ui/button"

const values = [
  {
    icon: Users,
    title: "People First",
    description: "We believe everyone deserves a home. Our solutions are designed to make housing accessible to all Nigerians.",
  },
  {
    icon: Target,
    title: "Transparency",
    description: "No hidden fees, no surprises. We believe in clear, honest communication with our customers.",
  },
  {
    icon: Heart,
    title: "Empathy",
    description: "We understand the challenges of renting in Nigeria. Our team has lived these experiences.",
  },
  {
    icon: Award,
    title: "Excellence",
    description: "We are committed to providing the best possible experience for both tenants and landlords.",
  },
]

const team = [
  { name: "Adaeze Nwankwo", role: "CEO & Co-Founder", bg: "bg-primary/20" },
  { name: "Chukwuemeka Obi", role: "CTO & Co-Founder", bg: "bg-secondary/30" },
  { name: "Fatimah Ibrahim", role: "Head of Operations", bg: "bg-accent/30" },
  { name: "Oluwaseun Adeleke", role: "Head of Finance", bg: "bg-primary/10" },
]

const milestones = [
  { year: "2021", title: "Founded", desc: "Shelterflex was born from a simple idea: make renting easier." },
  { year: "2022", title: "First 1,000 Tenants", desc: "Helped our first thousand Nigerians access housing." },
  { year: "2023", title: "Series A Funding", desc: "Raised $5M to expand across Nigeria." },
  { year: "2024", title: "10,000+ Tenants", desc: "Reached a major milestone in impact." },
]

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-background">
      {/* Hero */}
      <section className="border-b-3 border-foreground bg-muted py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl">
            <span className="mb-4 inline-block border-3 border-foreground bg-accent px-4 py-2 font-mono text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              ABOUT US
            </span>
            <h1 className="mb-6 font-mono text-4xl font-black leading-tight md:text-5xl lg:text-6xl text-balance">
              Making Housing <span className="text-primary">Accessible</span> for All Nigerians
            </h1>
            <p className="text-lg text-muted-foreground md:text-xl leading-relaxed">
              We are on a mission to solve one of Nigeria&apos;s biggest challenges: the burden of annual rent payments. Through innovative financing solutions, we are helping thousands of Nigerians find and afford their dream homes.
            </p>
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="grid gap-12 lg:grid-cols-2 items-center">
            <div>
              <h2 className="mb-6 font-mono text-3xl font-black md:text-4xl">Our Story</h2>
              <div className="space-y-4 text-muted-foreground leading-relaxed">
                <p>
                  In 2021, our founders experienced firsthand the struggle of paying annual rent in Lagos. Despite having good jobs and steady income, coming up with millions of naira upfront felt impossible.
                </p>
                <p>
                  They realized millions of Nigerians face the same challenge every year. The traditional rental system was broken - landlords wanted their money upfront, but tenants could not always provide it.
                </p>
                <p>
                  Shelterflex was born to bridge this gap. We pay landlords upfront while allowing tenants to spread their payments over months. It is a win-win that is transforming how Nigerians rent homes.
                </p>
              </div>
            </div>
            <div className="relative">
              <div className="border-3 border-foreground bg-primary/10 p-8 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
                <p className="font-mono text-2xl font-black md:text-3xl mb-4">
                  &quot;We believe everyone deserves a place to call home, regardless of their ability to pay upfront.&quot;
                </p>
                <p className="text-muted-foreground">- Adaeze Nwankwo, CEO</p>
              </div>
              <div className="absolute -right-4 -top-4 h-12 w-12 border-3 border-foreground bg-secondary" />
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="border-y-3 border-foreground bg-muted py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <span className="mb-4 inline-block border-3 border-foreground bg-secondary px-4 py-2 font-mono text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              OUR VALUES
            </span>
            <h2 className="font-mono text-3xl font-black md:text-4xl">What We Stand For</h2>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {values.map((value) => (
              <div
                key={value.title}
                className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                <value.icon className="mb-4 h-10 w-10 text-primary" />
                <h3 className="mb-2 font-mono text-xl font-bold">{value.title}</h3>
                <p className="text-sm text-muted-foreground">{value.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <h2 className="font-mono text-3xl font-black md:text-4xl">Our Journey</h2>
          </div>

          <div className="relative max-w-3xl mx-auto">
            <div className="absolute left-8 top-0 bottom-0 w-1 bg-foreground md:left-1/2 md:-translate-x-1/2" />
            
            {milestones.map((milestone, i) => (
              <div
                key={milestone.year}
                className={`relative mb-8 flex items-start gap-6 ${
                  i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"
                }`}
              >
                <div className={`hidden md:block md:w-1/2 ${i % 2 === 0 ? "md:text-right md:pr-12" : "md:pl-12"}`}>
                  <div className={`inline-block border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${
                    i % 2 === 0 ? "bg-primary/10" : "bg-secondary/20"
                  }`}>
                    <span className="font-mono text-3xl font-black text-primary">{milestone.year}</span>
                    <h3 className="font-mono text-lg font-bold">{milestone.title}</h3>
                    <p className="text-sm text-muted-foreground">{milestone.desc}</p>
                  </div>
                </div>
                
                <div className="absolute left-8 h-4 w-4 border-3 border-foreground bg-primary md:left-1/2 md:-translate-x-1/2" />
                
                <div className="ml-16 md:hidden">
                  <div className={`border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] ${
                    i % 2 === 0 ? "bg-primary/10" : "bg-secondary/20"
                  }`}>
                    <span className="font-mono text-3xl font-black text-primary">{milestone.year}</span>
                    <h3 className="font-mono text-lg font-bold">{milestone.title}</h3>
                    <p className="text-sm text-muted-foreground">{milestone.desc}</p>
                  </div>
                </div>
                
                <div className="hidden md:block md:w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section className="border-y-3 border-foreground bg-muted py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <span className="mb-4 inline-block border-3 border-foreground bg-accent px-4 py-2 font-mono text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              OUR TEAM
            </span>
            <h2 className="font-mono text-3xl font-black md:text-4xl">Meet the People Behind Shelterflex</h2>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 max-w-4xl mx-auto">
            {team.map((member) => (
              <div
                key={member.name}
                className="border-3 border-foreground bg-card shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
              >
                <div className={`aspect-square ${member.bg} flex items-center justify-center border-b-3 border-foreground`}>
                  <Users className="h-16 w-16 text-foreground/50" />
                </div>
                <div className="p-4">
                  <h3 className="font-mono font-bold">{member.name}</h3>
                  <p className="text-sm text-muted-foreground">{member.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary py-16 md:py-24">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-6 font-mono text-3xl font-black text-primary-foreground md:text-4xl text-balance">
            Ready to Join the Shelterflex Family?
          </h2>
          <p className="mb-8 text-lg text-primary-foreground/80 max-w-2xl mx-auto">
            Whether you are a tenant looking for flexible payments or a landlord wanting guaranteed income, we have got you covered.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/signup">
              <Button className="border-3 border-foreground bg-background px-8 py-6 text-lg font-bold text-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                Get Started
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/properties">
              <Button variant="outline" className="border-3 border-foreground bg-transparent px-8 py-6 text-lg font-bold text-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:bg-background/10">
                Browse Properties
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
