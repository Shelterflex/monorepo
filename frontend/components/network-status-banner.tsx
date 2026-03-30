'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCcw, Trash2, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  clearOfflineQueue,
  flushOfflineQueue,
  getOfflineQueueCount,
} from '@/lib/offline-queue'

const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL

export function NetworkStatusBanner() {
  const [isOnline, setIsOnline] = useState(true)
  const [showBackOnline, setShowBackOnline] = useState(false)
  const [queueCount, setQueueCount] = useState(0)

  const syncQueueCount = () => {
    setQueueCount(getOfflineQueueCount())
  }

  const handleSync = useCallback(async () => {
    if (!baseUrl) {
      return
    }

    await flushOfflineQueue(baseUrl)
    syncQueueCount()
  }, [])

  const handleClear = () => {
    clearOfflineQueue()
    syncQueueCount()
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleOnline = () => {
      setIsOnline(true)
      setShowBackOnline(true)
      void handleSync()
      setTimeout(() => setShowBackOnline(false), 3000)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setShowBackOnline(false)
    }

    const handleQueueUpdate = () => {
      syncQueueCount()
    }

    let isMounted = true
    Promise.resolve().then(() => {
      if (isMounted) {
        setIsOnline(navigator.onLine)
        syncQueueCount()
      }
    })

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('offline-queue-updated', handleQueueUpdate)

    return () => {
      isMounted = false
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('offline-queue-updated', handleQueueUpdate)
    }
  }, [handleSync])

  if (isOnline && !showBackOnline && queueCount === 0) return null

  return (
    <div
      className={`fixed bottom-4 left-1/2 z-50 flex w-[min(95vw,40rem)] -translate-x-1/2 items-center justify-between gap-3 rounded-2xl px-4 py-3 shadow-lg transition-all duration-300 ${
        isOnline ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
      }`}
    >
      <div className="flex items-center gap-2">
        {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        <span className="text-sm font-medium">
          {isOnline ? 'Back online' : 'You are currently offline'}
          {queueCount > 0 ? ` • ${queueCount} queued action${queueCount === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      {queueCount > 0 ? (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-8 bg-white/20 text-white hover:bg-white/30"
            onClick={() => void handleSync()}
          >
            <RefreshCcw className="mr-2 h-3.5 w-3.5" />
            Sync
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-white hover:bg-white/10 hover:text-white"
            onClick={handleClear}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  )
}
