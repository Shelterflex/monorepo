import Link from "next/link"
import { Briefcase, ArrowLeft } from "lucide-react"

export const metadata = {
  title: "Careers — Shelterflex",
  description: "Join the Shelterflex team and help build the future of rent financing and real estate.",
}

export default function CareersPage() {
  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-24">
      <div className="max-w-xl w-full border-4 border-foreground bg-card p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center border-3 border-foreground bg-primary shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <Briefcase className="h-8 w-8 text-foreground" />
        </div>
        <span className="font-mono text-xs font-bold uppercase tracking-wider bg-primary/20 text-foreground px-3 py-1 border-2 border-foreground">
          Coming Soon
        </span>
        <h1 className="font-mono text-3xl font-black mt-4 mb-3 tracking-tight">
          Careers at Shelterflex
        </h1>
        <p className="text-muted-foreground mb-8 leading-relaxed">
          We are always looking for exceptional talent passionate about real estate, fintech, and decentralized finance. Open positions will be posted here soon.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 font-mono font-bold px-6 py-3 border-2 border-foreground bg-primary text-foreground shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
          <a
            href="mailto:hello@shelterflex.com?subject=Careers%20at%20Shelterflex"
            className="inline-flex items-center justify-center font-mono font-bold px-6 py-3 border-2 border-foreground bg-background text-foreground shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
          >
            Get in Touch
          </a>
        </div>
      </div>
    </main>
  )
}
