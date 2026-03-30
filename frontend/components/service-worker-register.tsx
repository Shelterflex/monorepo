'use client'

import { useEffect } from 'react'
import { flushOfflineQueue } from '@/lib/offline-queue'

const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    navigator.serviceWorker.register('/sw.js').catch((error) => {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to register service worker', error)
      }
    })

    const flushQueue = async () => {
      if (!baseUrl || !navigator.onLine) {
        return
      }

      await flushOfflineQueue(baseUrl)
    }

    void flushQueue()
    window.addEventListener('online', flushQueue)

    return () => {
      window.removeEventListener('online', flushQueue)
    }
  }, [])

  return null
}
