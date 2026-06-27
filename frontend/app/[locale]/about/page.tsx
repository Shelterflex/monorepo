"use client"

import Link from "next/link"
import { ArrowRight, Users, Target, Heart, Award } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"

const valuesKeys = [
  {
    icon: Users,
    key: "peopleFirst",
  },
  {
    icon: Target,
    key: "transparency",
  },
  {
    icon: Heart,
    key: "empathy",
  },
  {
    icon: Award,
    key: "excellence",
  },
]

const teamKeys = [
  { name: "Adaeze Nwankwo", key: "adaeze", bg: "bg-primary/20" },
  { name: "Chukwuemeka Obi", key: "chukwuemeka", bg: "bg-secondary/30" },
  { name: "Fatimah Ibrahim", key: "fatimah", bg: "bg-accent/30" },
  { name: "Oluwaseun Adeleke", key: "oluwaseun", bg: "bg-primary/10" },
]

const milestoneKeys = [
  { year: "2021", key: "m2021" },
  { year: "2022", key: "m2022" },
  { year: "2023", key: "m2023" },
  { year: "2024", key: "m2024" },
]

export default function AboutPage() {
  const t = useTranslations("about")

  const values = valuesKeys.map((item) => ({
    icon: item.icon,
    title: t(`values.${item.key}.title`),
    description: t(`values.${item.key}.description`),
  }))

  const team = teamKeys.map((item) => ({
    name: item.name,
    role: t(`team.members.${item.key}.role`),
    bg: item.bg,
  }))

  const milestones = milestoneKeys.map((item) => ({
    year: item.year,
    title: t(`journey.milestones.${item.key}.title`),
    desc: t(`journey.milestones.${item.key}.desc`),
  }))

  return (
    <main className="min-h-screen bg-background">
      {/* Hero */}
      <section className="border-b-3 border-foreground bg-muted py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl">
            <span className="mb-4 inline-block border-3 border-foreground bg-accent px-4 py-2 font-mono text-sm font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              {t("badge")}
            </span>
            <h1 className="mb-6 font-mono text-4xl font-black leading-tight md:text-5xl lg:text-6xl text-balance">
              {t.rich("title", {
                accessible: (chunks) => <span className="text-primary">{chunks}</span>
              })}
            </h1>
            <p className="text-lg text-muted-foreground md:text-xl leading-relaxed">
              {t("description")}
            </p>
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="grid gap-12 lg:grid-cols-2 items-center">
            <div>
              <h2 className="mb-6 font-mono text-3xl font-black md:text-4xl">{t("story.title")}</h2>
              <div className="space-y-4 text-muted-foreground leading-relaxed">
                <p>
                  {t("story.p1")}
                </p>
                <p>
                  {t("story.p2")}
                </p>
                <p>
                  {t("story.p3")}
                </p>
              </div>
            </div>
            <div className="relative">
              <div className="border-3 border-foreground bg-primary/10 p-8 shadow-[8px_8px_0px_0px_rgba(26,26,26,1)]">
                <p className="font-mono text-2xl font-black md:text-3xl mb-4">
                  {t("story.quote")}
                </p>
                <p className="text-muted-foreground">{t("story.author")}</p>
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
              {t("values.badge")}
            </span>
            <h2 className="font-mono text-3xl font-black md:text-4xl">{t("values.title")}</h2>
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
            <h2 className="font-mono text-3xl font-black md:text-4xl">{t("journey.title")}</h2>
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
              {t("team.badge")}
            </span>
            <h2 className="font-mono text-3xl font-black md:text-4xl">{t("team.title")}</h2>
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
            {t("cta.title")}
          </h2>
          <p className="mb-8 text-lg text-primary-foreground/80 max-w-2xl mx-auto">
            {t("cta.desc")}
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/signup">
              <Button className="border-3 border-foreground bg-background px-8 py-6 text-lg font-bold text-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                {t("cta.getStarted")}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/properties">
              <Button variant="outline" className="border-3 border-foreground bg-transparent px-8 py-6 text-lg font-bold text-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:bg-background/10">
                {t("cta.browseProperties")}
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
