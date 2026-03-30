'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface PollingConfig {
  initialInterval?: number
  maxInterval?: number
  backoffMultiplier?: number
  maxRetries?: number
  stopOnStatuses?: string[]
  enabled?: boolean
}

export interface PollingResult<T> {
  data: T | null
  error: Error | null
  isPolling: boolean
  currentInterval: number
  retryCount: number
  poll: () => Promise<void>
  stop: () => void
  restart: () => void
}

const DEFAULT_CONFIG: Required<PollingConfig> = {
  initialInterval: 2000,
  maxInterval: 10000,
  backoffMultiplier: 2,
  maxRetries: 5,
  stopOnStatuses: ['confirmed', 'conversion_failed', 'staking_failed'],
  enabled: true,
}

export function usePolling<T>(
  pollFn: () => Promise<{ data: T; status: string }>,
  config: PollingConfig = {},
): PollingResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [currentInterval, setCurrentInterval] = useState(
    (config.initialInterval ?? DEFAULT_CONFIG.initialInterval),
  )
  const [retryCount, setRetryCount] = useState(0)

  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef(true)
  const isPollingRef = useRef(false)
  const configRef = useRef({ ...DEFAULT_CONFIG, ...config })
  const pollFnRef = useRef(pollFn)
  const executePollRef = useRef<(manual?: boolean) => Promise<void>>(async () => {})

  useEffect(() => {
    configRef.current = { ...DEFAULT_CONFIG, ...config }
  }, [config])

  useEffect(() => {
    pollFnRef.current = pollFn
  }, [pollFn])

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    isPollingRef.current = false
    setIsPolling(false)
    clearPendingTimeout()
  }, [clearPendingTimeout])

  const scheduleNextPoll = useCallback(
    (interval: number, execute: () => Promise<void>) => {
      clearPendingTimeout()
      timeoutRef.current = setTimeout(() => {
        void execute()
      }, interval)
    },
    [clearPendingTimeout],
  )

  const executePoll = useCallback(
    async (manual = false) => {
      if (!isMountedRef.current || (!manual && !isPollingRef.current)) {
        return
      }

      try {
        const result = await pollFnRef.current()
        if (!isMountedRef.current || (!manual && !isPollingRef.current)) {
          return
        }

        setData(result.data)
        setError(null)
        setRetryCount(0)
        setCurrentInterval(configRef.current.initialInterval)

        if (configRef.current.stopOnStatuses.includes(result.status)) {
          stop()
          return
        }

        if (isPollingRef.current) {
          scheduleNextPoll(configRef.current.initialInterval, () => executePollRef.current())
        }
      } catch (err) {
        if (!isMountedRef.current || (!manual && !isPollingRef.current)) {
          return
        }

        const nextError = err instanceof Error ? err : new Error('Polling failed')
        setError(nextError)

        setRetryCount((previous) => {
          const nextRetryCount = previous + 1

          if (nextRetryCount >= configRef.current.maxRetries) {
            stop()
            return nextRetryCount
          }

          const nextInterval = Math.min(
            configRef.current.initialInterval *
              Math.pow(configRef.current.backoffMultiplier, nextRetryCount),
            configRef.current.maxInterval,
          )

          setCurrentInterval(nextInterval)

          if (isPollingRef.current) {
            scheduleNextPoll(nextInterval, () => executePollRef.current())
          }

          return nextRetryCount
        })
      }
    },
    [scheduleNextPoll, stop],
  )

  useEffect(() => {
    executePollRef.current = executePoll
  }, [executePoll])

  const start = useCallback(() => {
    if (isPollingRef.current || !configRef.current.enabled) {
      return
    }

    isPollingRef.current = true
    setIsPolling(true)
    void executePoll()
  }, [executePoll])

  const poll = useCallback(async () => {
    await executePoll(true)
  }, [executePoll])

  const restart = useCallback(() => {
    stop()
    setData(null)
    setError(null)
    setRetryCount(0)
    setCurrentInterval(configRef.current.initialInterval)
    isPollingRef.current = true
    setIsPolling(true)
    void executePoll()
  }, [executePoll, stop])

  useEffect(() => {
    if (configRef.current.enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      start()
    } else {
      stop()
    }
  }, [start, stop, config.enabled])

  useEffect(() => {
    return () => {
      isMountedRef.current = false
      isPollingRef.current = false
      clearPendingTimeout()
    }
  }, [clearPendingTimeout])

  return {
    data,
    error,
    isPolling,
    currentInterval,
    retryCount,
    poll,
    stop,
    restart,
  }
}
