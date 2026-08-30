'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { initializeAnalytics, trackPageView } from '@/lib/analytics-init'

export function AnalyticsTracker() {
  const pathname = usePathname()

  useEffect(() => {
    initializeAnalytics()
  }, [])

  useEffect(() => {
    if (pathname) trackPageView(pathname)
  }, [pathname])

  return null
}
