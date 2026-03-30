import React from "react"
import type { Metadata } from 'next'
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'
import { Toaster } from '@/components/ui/toaster'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { NetworkStatusBanner } from '@/components/network-status-banner'
import { ServiceWorkerRegister } from '@/components/service-worker-register'
import { WebVitalsReporter } from '@/components/web-vitals-reporter'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sheltaflex - Rent Now, Pay Later',
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
    <html lang="en">
      <body className={`font-sans antialiased`}>
        <ErrorBoundary>
          <ServiceWorkerRegister />
          <WebVitalsReporter />
          <NetworkStatusBanner />
          <Header />
          {children}
          <Footer />
          <Toaster />
        </ErrorBoundary>
      </body>
    </html>
  )
}
