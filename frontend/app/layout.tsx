import React from "react"
import type { Metadata } from 'next'
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'
import { Toaster } from '@/components/ui/toaster'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { NetworkStatusBanner } from '@/components/network-status-banner'
import { WebVitalsReporter } from '@/components/web-vitals-reporter'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sheltaflex - Rent Now, Pay Later',
  description: 'The smarter way to pay your rent. Split your rent payments into affordable monthly installments.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
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
