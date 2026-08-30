import React from "react";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { LocaleDocumentSync } from "@/components/locale-document-sync";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { locales, type Locale, rtlLocales } from "@/i18n";
import "../globals.css";

export const metadata: Metadata = {
  title: "Shelterflex - Rent Now, Pay Later",
  description:
    "Shelterflex - The modern way to rent. Get your rent financed upfront and pay back in flexible monthly installments.",
  generator: "v0.app",
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Validate that the incoming `locale` parameter is valid
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  // Providing all messages to the client side is the easiest way to get started
  const messages = await getMessages();

  // Determine text direction
  const dir = rtlLocales.includes(locale as Locale) ? "rtl" : "ltr";

  // Header, Footer, NetworkStatusBanner, ServiceWorkerRegister, ErrorBoundary,
  // and Toaster all already come from the root layout (app/layout.tsx), which
  // wraps every route including this one — rendering them again here would
  // duplicate them on screen. Only locale-specific concerns belong in this layout.
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <LocaleDocumentSync locale={locale} dir={dir} />
      <WebVitalsReporter />
      {children}
    </NextIntlClientProvider>
  );
}
