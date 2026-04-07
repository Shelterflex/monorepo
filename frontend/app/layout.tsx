import React from "react"
import type { Metadata } from 'next'
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'
import { Toaster } from '@/components/ui/toaster'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { NetworkStatusBanner } from '@/components/network-status-banner'
import { ServiceWorkerRegister } from '@/components/service-worker-register'
import { WebVitalsReporter } from '@/components/web-vitals-reporter'
import { PerformanceMonitor } from '@/components/PerformanceMonitor'
import { ThemeProvider } from '@/components/theme-provider'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Shelterflex - Rent Now, Pay Later',
  description: 'The smarter way to pay your rent. Split your rent payments into affordable monthly installments.',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ErrorBoundary>
            <ServiceWorkerRegister />
            <WebVitalsReporter />
            <PerformanceMonitor />
            <NetworkStatusBanner />
            <Header />
            {children}
            <Footer />
            <Toaster />
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  )
}
