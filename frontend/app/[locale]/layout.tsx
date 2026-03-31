import React from "react";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Toaster } from "@/components/ui/toaster";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LocaleDocumentSync } from "@/components/locale-document-sync";
import { NetworkStatusBanner } from "@/components/network-status-banner";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { locales, type Locale, rtlLocales } from "@/i18n";
import "../globals.css";

export const metadata: Metadata = {
  title: "Shelterflex - Rent Now, Pay Later",
  description:
    "Shelterflex - The modern way to rent. Get your rent financed upfront and pay back in flexible monthly installments.",
  generator: "v0.app",
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
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
  params: { locale: string };
}) {
  const { locale } = await Promise.resolve(params);

  // Validate that the incoming `locale` parameter is valid
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  // Providing all messages to the client side is the easiest way to get started
  const messages = await getMessages();

  // Determine text direction
  const dir = rtlLocales.includes(locale as Locale) ? "rtl" : "ltr";

  return (
    <NextIntlClientProvider messages={messages}>
      <LocaleDocumentSync locale={locale} dir={dir} />
      <ErrorBoundary>
        <ServiceWorkerRegister />
        <WebVitalsReporter />
        <NetworkStatusBanner />
        <Header />
        {children}
        <Footer />
        <Toaster />
      </ErrorBoundary>
    </NextIntlClientProvider>
  );
}
