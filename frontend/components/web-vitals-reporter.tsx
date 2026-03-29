'use client'

import { useEffect } from 'react'
import type { Metric } from 'web-vitals'
import {
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
} from 'web-vitals'

type Props = {
  endpoint?: string
}

function sendToEndpoint(endpoint: string, metric: Metric) {
  const body = JSON.stringify(metric)

  if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    navigator.sendBeacon(endpoint, body)
    return
  }

  fetch(endpoint, {
    body,
    method: 'POST',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
    },
  }).catch(() => {})
}

export function WebVitalsReporter({ endpoint = '/__vitals' }: Props) {
  useEffect(() => {
    const handler = (metric: Metric) => {
      if (process.env.NODE_ENV !== 'production') {
        return
      }

      sendToEndpoint(endpoint, metric)
    }

    onCLS(handler)
    onFCP(handler)
    onINP(handler)
    onLCP(handler)
    onTTFB(handler)
  }, [endpoint])

  return null
}
