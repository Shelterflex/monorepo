import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Cookie Policy — Shelterflex",
  description:
    "Understand how Shelterflex uses cookies and similar technologies. Official legal copy will be updated before launch.",
};

const PLACEHOLDER =
  "This section will be updated before launch. Official legal copy is being prepared by our legal team.";

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      lastUpdated="May 30, 2026"
      sections={[
        {
          title: "1. What Are Cookies",
          content: <p>{PLACEHOLDER}</p>,
        },
        {
          title: "2. Cookies We Use",
          content: <p>{PLACEHOLDER}</p>,
        },
        {
          title: "3. Managing Cookies",
          content: <p>{PLACEHOLDER}</p>,
        },
        {
          title: "4. Third-Party Cookies",
          content: <p>{PLACEHOLDER}</p>,
        },
        {
          title: "5. Updates to This Policy",
          content: <p>{PLACEHOLDER}</p>,
        },
        {
          title: "6. Contact",
          content: (
            <p>
              Cookie-related questions? Email{" "}
              <a
                href="mailto:privacy@shelterflex.com"
                className="underline hover:text-foreground"
              >
                privacy@shelterflex.com
              </a>
              .
            </p>
          ),
        },
      ]}
    />
  );
}
