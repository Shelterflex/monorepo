import React from "react"
import type { Metadata } from 'next'
import { cookies } from "next/headers"
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'
import { Toaster } from '@/components/ui/toaster'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { NetworkStatusBanner } from '@/components/network-status-banner'
import SkipLink from '@/components/SkipLink'
import { ServiceWorkerRegister } from '@/components/service-worker-register'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { PerformanceMonitor } from '@/components/PerformanceMonitor'
import { ThemeProvider } from '@/components/theme-provider'
import { CurrencyProvider } from '@/contexts/CurrencyContext'
import { FeatureFlagProvider } from '@/lib/featureFlags'
import { WalletProvider } from '@/contexts/WalletContext'
import { CookieConsentProvider } from '@/contexts/CookieConsentContext'
import { CookieConsentBanner } from '@/components/CookieConsentBanner'
import { AnalyticsTracker } from '@/components/AnalyticsTracker'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { NextIntlClientProvider } from "next-intl"
import { locales, defaultLocale, rtlLocales, type Locale } from "@/i18n"
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  DEFAULT_TITLE,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo"

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  // metadataBase makes every relative canonical/OpenGraph URL below resolve to
  // an absolute one, which is what crawlers and link unfurlers require.
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    // Per-route titles read as "<page> | Shelterflex" without repeating the
    // suffix in every route's metadata export.
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: SITE_URL,
    images: [{ url: DEFAULT_OG_IMAGE, alt: SITE_NAME }],
  },
  twitter: {
    card: 'summary',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value
  const locale = locales.includes(cookieLocale as Locale) ? (cookieLocale as Locale) : defaultLocale
  const dir = rtlLocales.includes(locale) ? "rtl" : "ltr"
  const messages = (await import(`../messages/${locale}.json`)).default

  return (
    <html suppressHydrationWarning lang={locale} dir={dir}>
      <head>
        <meta name="theme-color" content="#ff6b35" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NextIntlClientProvider locale={locale} messages={messages}>
            <FeatureFlagProvider>
            <CurrencyProvider>
              <WalletProvider>
              <CookieConsentProvider>
              <ErrorBoundary>
                <ServiceWorkerRegister />
                <SpeedInsights />
                <PerformanceMonitor />
                <AnalyticsTracker />
                <NetworkStatusBanner />
                <SkipLink />
                <Header />
                <div id="main-content" />
                {children}
                <Footer />
                <Toaster />
                <CookieConsentBanner />
              </ErrorBoundary>
              </CookieConsentProvider>
              </WalletProvider>
            </CurrencyProvider>
            </FeatureFlagProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
