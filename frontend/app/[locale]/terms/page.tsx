import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Terms of Service — Shelterflex",
  description:
    "Read the Shelterflex Terms of Service. Official legal copy will be updated before launch.",
};

const PLACEHOLDER =
  "This section will be updated before launch. Official legal copy is being prepared by our legal team.";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="May 30, 2026"
      sections={[
        {
          title: "1. Acceptance of Terms",
          content: <p>{PLACEHOLDER}</p>,
        },
        {
          title: "2. Use of Service",
          content: <p>{PLACEHOLDER}</p>,
        },
        {
          title: "3. Tenant Payment Terms",
          content: <p>{PLACEHOLDER}</p>,
        },
        {
          title: "4. Landlord Obligations",
          content: <p>{PLACEHOLDER}</p>,
        },
        {
          title: "5. Limitation of Liability",
          content: <p>{PLACEHOLDER}</p>,
        },
        {
          title: "6. Contact",
          content: (
            <p>
              Questions about these terms? Email{" "}
              <a
                href="mailto:legal@shelterflex.com"
                className="underline hover:text-foreground"
              >
                legal@shelterflex.com
              </a>
              .
            </p>
          ),
        },
      ]}
    />
  );
}
