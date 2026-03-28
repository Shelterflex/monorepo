'use client'

import React, { useState, useEffect } from 'react'
import { WifiOff, Wifi } from 'lucide-react'

export function NetworkStatusBanner() {
  const [isOnline, setIsOnline] = useState(true)
  const [showBackOnline, setShowBackOnline] = useState(false)

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return

    const handleOnline = () => {
      setIsOnline(true)
      setShowBackOnline(true)
      // Hide the "back online" message after 3 seconds
      setTimeout(() => setShowBackOnline(false), 3000)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setShowBackOnline(false)
    }

    // Initial check (async to avoid setState in effect warning)
    let isMounted = true
    Promise.resolve().then(() => {
      if (isMounted) setIsOnline(navigator.onLine)
    })

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      isMounted = false
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (isOnline && !showBackOnline) return null

  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center gap-2 px-4 py-2 rounded-full shadow-lg transition-all duration-300 ${
        isOnline
          ? 'bg-green-500 text-white translate-y-0 opacity-100'
          : 'bg-red-500 text-white translate-y-0 opacity-100'
      }`}
    >
      {isOnline ? (
        <>
          <Wifi className="w-4 h-4" />
          <span className="text-sm font-medium">Back online</span>
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4" />
          <span className="text-sm font-medium">You are currently offline</span>
        </>
      )}
    </div>
  )
}
