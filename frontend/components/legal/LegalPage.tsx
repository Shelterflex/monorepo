import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

type LegalSection = {
  title: string;
  content: ReactNode;
};

type LegalPageProps = {
  title: string;
  lastUpdated?: string;
  sections: LegalSection[];
};

export function LegalPage({ title, lastUpdated, sections }: LegalPageProps) {
  const t = useTranslations("common");

  return (
    <main className="min-h-screen bg-background py-12 px-4 pt-32">
      <div className="mx-auto max-w-4xl">
        <Link href="/">
          <button
            type="button"
            className="mb-8 flex items-center gap-2 border-3 border-foreground bg-card px-4 py-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
          >
            <ArrowLeft className="h-5 w-5" />
            {t("backToHome")}
          </button>
        </Link>

        <div className="border-3 border-foreground bg-card p-6 md:p-8 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <h1 className="mb-2 font-mono text-3xl font-black md:text-4xl">
            {title}
          </h1>
          {lastUpdated && (
            <p className="mb-8 text-sm text-muted-foreground">
              {t("lastUpdated")}: {lastUpdated}
            </p>
          )}

          <div className="space-y-8 text-sm md:text-base">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="mb-3 font-mono text-xl font-bold">
                  {section.title}
                </h2>
                <div className="text-muted-foreground leading-relaxed">
                  {section.content}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
