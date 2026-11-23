import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import type { Metric } from 'web-vitals'
import { WebVitalsReporter } from '../web-vitals-reporter'

const handlers = vi.hoisted(() => ({} as Record<string, (metric: unknown) => void>))

vi.mock('web-vitals', () => ({
  onCLS: (h: (m: unknown) => void) => { handlers.CLS = h },
  onFCP: (h: (m: unknown) => void) => { handlers.FCP = h },
  onINP: (h: (m: unknown) => void) => { handlers.INP = h },
  onLCP: (h: (m: unknown) => void) => { handlers.LCP = h },
  onTTFB: (h: (m: unknown) => void) => { handlers.TTFB = h },
}))

const metric = {
  name: 'LCP',
  value: 1234,
  rating: 'good',
  delta: 1234,
  id: 'v1-1',
  navigationType: 'navigate',
} as unknown as Metric

describe('WebVitalsReporter', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    delete (navigator as { sendBeacon?: unknown }).sendBeacon
  })

  it('registers a handler for each core web vital', () => {
    render(<WebVitalsReporter />)

    expect(Object.keys(handlers).sort()).toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB'])
  })

  it('posts the metric as JSON to the default endpoint with fetch when sendBeacon is unavailable', () => {
    render(<WebVitalsReporter />)

    handlers.LCP(metric)

    expect(fetch).toHaveBeenCalledWith('/__vitals', {
      body: JSON.stringify(metric),
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('uses sendBeacon with the custom endpoint when it is supported', () => {
    const sendBeacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true })

    render(<WebVitalsReporter endpoint="/metrics" />)
    handlers.LCP(metric)

    expect(sendBeacon).toHaveBeenCalledWith('/metrics', JSON.stringify(metric))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not report metrics outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')

    render(<WebVitalsReporter />)
    handlers.LCP(metric)

    expect(fetch).not.toHaveBeenCalled()
  })
})
