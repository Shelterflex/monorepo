import Link from "next/link";
import { ArrowLeft, Briefcase } from "lucide-react";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Careers",
  description:
    "Join the Shelterflex team and help revolutionize how people pay rent and build equity.",
  path: "/careers",
});

export default function CareersPage() {
  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b-3 border-foreground bg-muted py-8 md:py-12 lg:py-16">
        <div className="container mx-auto px-4">
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Home
          </Link>

          <div className="flex flex-wrap items-start gap-3 mb-3">
            <h1 className="font-mono text-2xl font-black md:text-4xl lg:text-5xl">
              Careers at <span className="text-primary">Shelterflex</span>
            </h1>
            <span className="self-start mt-1 border-3 border-foreground bg-secondary/20 px-2 py-0.5 font-mono text-xs font-bold uppercase shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
              Coming Soon
            </span>
          </div>

          <p className="text-sm text-muted-foreground max-w-2xl md:text-base lg:text-lg">
            We are building a world-class team dedicated to transforming rental housing and financial flexibility across Africa.
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 text-center max-w-xl">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center border-3 border-foreground bg-primary/10 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <Briefcase className="h-8 w-8 text-primary" />
          </div>
          <h2 className="font-mono text-xl font-black mb-2">No Open Roles At This Moment</h2>
          <p className="text-sm text-muted-foreground mb-6">
            We are currently gearing up for our next phase of hiring. Check back soon or send your resume to{" "}
            <a href="mailto:careers@shelterflex.com" className="text-primary underline font-bold">
              careers@shelterflex.com
            </a>.
          </p>
        </div>
      </section>
    </main>
  );
}
