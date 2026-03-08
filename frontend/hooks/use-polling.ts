'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * Configuration for the polling mechanism
 */
export interface PollingConfig {
  /** Initial polling interval in milliseconds (default: 2000) */
  initialInterval?: number
  /** Maximum polling interval in milliseconds (default: 10000) */
  maxInterval?: number
  /** Backoff multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number
  /** Maximum number of retries on error (default: 5) */
  maxRetries?: number
  /** Statuses that should stop polling (default: ['confirmed', 'conversion_failed', 'staking_failed']) */
  stopOnStatuses?: string[]
  /** Whether polling is enabled (default: true) */
  enabled?: boolean
}

/**
 * Result returned by the usePolling hook
 */
export interface PollingResult<T> {
  /** Current data from the polling function */
  data: T | null
  /** Current error if polling failed */
  error: Error | null
  /** Whether polling is currently active */
  isPolling: boolean
  /** Current polling interval in milliseconds */
  currentInterval: number
  /** Number of consecutive errors */
  retryCount: number
  /** Manually trigger a poll */
  poll: () => Promise<void>
  /** Stop polling */
  stop: () => void
  /** Restart polling from initial state */
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

/**
 * Custom hook for polling with exponential backoff
 * 
 * @param pollFn - Async function that returns data and status
 * @param config - Polling configuration
 * @returns Polling state and control functions
 * 
 * @example
 * ```tsx
 * const { data, error, isPolling } = usePolling(
 *   async () => {
 *     const response = await fetchStatus(transactionId)
 *     return { data: response, status: response.status }
 *   },
 *   {
 *     initialInterval: 2000,
 *     maxRetries: 5,
 *     stopOnStatuses: ['confirmed', 'failed']
 *   }
 * )
 * ```
 */
export function usePolling<T>(
  pollFn: () => Promise<{ data: T; status: string }>,
  config: PollingConfig = {}
): PollingResult<T> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }
  
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [currentInterval, setCurrentInterval] = useState(mergedConfig.initialInterval)
  const [retryCount, setRetryCount] = useState(0)
  
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef(true)
  const isPollingRef = useRef(false)
  const configRef = useRef(mergedConfig)
  const pollFnRef = useRef(pollFn)
  
  // Update refs when dependencies change
  useEffect(() => {
    configRef.current = { ...DEFAULT_CONFIG, ...config }
  }, [config])
  
  useEffect(() => {
    pollFnRef.current = pollFn
  }, [pollFn])
  
  // Sync isPollingRef with isPolling state
  useEffect(() => {
    isPollingRef.current = isPolling
  }, [isPolling])
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      isPollingRef.current = false
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])
  
  const stop = useCallback(() => {
    isPollingRef.current = false
    setIsPolling(false)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])
  
  const poll = useCallback(async () => {
    if (!isMountedRef.current || !isPollingRef.current) return
    
    try {
      const result = await pollFnRef.current()
      
      if (!isMountedRef.current || !isPollingRef.current) return
      
      setData(result.data)
      setError(null)
      setRetryCount(0)
      setCurrentInterval(configRef.current.initialInterval)
      
      // Check if we should stop polling based on status
      if (configRef.current.stopOnStatuses.includes(result.status)) {
        stop()
        return
      }
      
      // Schedule next poll
      if (isPollingRef.current) {
        timeoutRef.current = setTimeout(() => {
          poll()
        }, configRef.current.initialInterval)
      }
    } catch (err) {
      if (!isMountedRef.current || !isPollingRef.current) return
      
      const error = err instanceof Error ? err : new Error('Polling failed')
      setError(error)
      
      setRetryCount(prev => {
        const newRetryCount = prev + 1
        
        // Check if we've exceeded max retries
        if (newRetryCount >= configRef.current.maxRetries) {
          stop()
          return newRetryCount
        }
        
        // Calculate next interval with exponential backoff
        const nextInterval = Math.min(
          configRef.current.initialInterval * Math.pow(configRef.current.backoffMultiplier, newRetryCount),
          configRef.current.maxInterval
        )
        setCurrentInterval(nextInterval)
        
        // Schedule retry with backoff
        if (isPollingRef.current) {
          timeoutRef.current = setTimeout(() => {
            poll()
          }, nextInterval)
        }
        
        return newRetryCount
      })
    }
  }, [stop])
  
  const restart = useCallback(() => {
    stop()
    setData(null)
    setError(null)
    setRetryCount(0)
    setCurrentInterval(configRef.current.initialInterval)
    isPollingRef.current = true
    setIsPolling(true)
  }, [stop])
  
  // Start polling when enabled
  useEffect(() => {
    if (configRef.current.enabled && !isPolling) {
      isPollingRef.current = true
      setIsPolling(true)
    }
  }, [configRef.current.enabled, isPolling])
  
  // Trigger initial poll when polling starts
  useEffect(() => {
    if (isPolling && configRef.current.enabled) {
      poll()
    }
    
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
    // Only run when isPolling changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPolling])
  
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
