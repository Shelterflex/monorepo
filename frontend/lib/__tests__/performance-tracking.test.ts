import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../analytics', () => ({
  analytics: { track: vi.fn() },
}))

import PerformanceTracking, { performanceTracking } from '../performance-tracking'
import { analytics } from '../analytics'

// Minimal stand-in for PerformanceObserver: records every observer and lets
// tests push entries to whichever observers are watching a given entry type.
class FakePerformanceObserver {
  static instances: FakePerformanceObserver[] = []
  entryTypes: string[] = []
  disconnect = vi.fn()

  constructor(private callback: PerformanceObserverCallback) {
    FakePerformanceObserver.instances.push(this)
  }

  observe(options: PerformanceObserverInit) {
    this.entryTypes = options.entryTypes ?? []
  }

  static emit(entryType: string, entries: Array<Partial<PerformanceEntry> & Record<string, unknown>>) {
    const list = {
      getEntries: () => entries.map(e => ({ entryType, ...e })),
    } as unknown as PerformanceObserverEntryList
    FakePerformanceObserver.instances
      .filter(o => o.entryTypes.includes(entryType))
      .forEach(o => o.callback(list, o as unknown as PerformanceObserver))
  }
}

type Listener = (event: Event) => void

const trackCalls = (event: string) =>
  vi.mocked(analytics.track).mock.calls.filter(([name]) => name === event).map(([, props]) => props)

describe('PerformanceTracking', () => {
  let pt: PerformanceTracking
  let listeners: Record<string, Listener[]>

  beforeEach(() => {
    vi.clearAllMocks()
    FakePerformanceObserver.instances = []
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver)

    // Capture window listeners instead of registering them, so instances from
    // other tests can't react to events dispatched here.
    listeners = {}
    vi.spyOn(globalThis, 'addEventListener').mockImplementation(((type: string, listener: Listener) => {
      ;(listeners[type] ||= []).push(listener)
    }) as typeof globalThis.addEventListener)

    pt = new PerformanceTracking()
  })

  afterEach(() => {
    pt.stopTracking()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('exposes a singleton instance', () => {
    expect(PerformanceTracking.getInstance()).toBe(performanceTracking)
  })

  describe('startTracking / stopTracking', () => {
    it('registers one observer per entry type', () => {
      pt.startTracking()
      expect(FakePerformanceObserver.instances.map(o => o.entryTypes)).toEqual([
        ['largest-contentful-paint'],
        ['first-input'],
        ['layout-shift'],
        ['paint'],
        ['navigation'],
        ['resource'],
      ])
    })

    it('registers interaction listeners with once + passive', () => {
      pt.startTracking()
      expect(globalThis.addEventListener).toHaveBeenCalledWith('click', expect.any(Function), { once: true, passive: true })
      expect(Object.keys(listeners)).toEqual(expect.arrayContaining(['click', 'scroll', 'keydown', 'touchstart']))
    })

    it('is a no-op when already tracking', () => {
      pt.startTracking()
      pt.startTracking()
      expect(FakePerformanceObserver.instances).toHaveLength(6)
    })

    it('stopTracking disconnects every observer and allows restarting', () => {
      pt.startTracking()
      const first = [...FakePerformanceObserver.instances]
      pt.stopTracking()
      first.forEach(o => expect(o.disconnect).toHaveBeenCalledTimes(1))

      pt.startTracking()
      expect(FakePerformanceObserver.instances).toHaveLength(12)
    })

    it('skips observers when PerformanceObserver is unavailable', () => {
      vi.unstubAllGlobals()
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'PerformanceObserver')
      delete (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver
      try {
        pt.startTracking()
        expect(FakePerformanceObserver.instances).toHaveLength(0)
        expect(listeners.click).toHaveLength(1)
      } finally {
        if (descriptor) Object.defineProperty(globalThis, 'PerformanceObserver', descriptor)
      }
    })

    it('warns instead of throwing when observer setup fails', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubGlobal('PerformanceObserver', class {
        constructor() {
          throw new Error('unsupported')
        }
      })
      expect(() => pt.startTracking()).not.toThrow()
      expect(warn).toHaveBeenCalledWith('Failed to setup Core Web Vitals tracking:', expect.any(Error))
      expect(warn).toHaveBeenCalledWith('Failed to setup navigation timing tracking:', expect.any(Error))
      expect(warn).toHaveBeenCalledWith('Failed to setup resource timing tracking:', expect.any(Error))
    })
  })

  describe('Core Web Vitals', () => {
    beforeEach(() => pt.startTracking())

    it('records LCP from the last entry with a rating', () => {
      FakePerformanceObserver.emit('largest-contentful-paint', [{ startTime: 1000 }, { startTime: 3000 }])
      expect(pt.getMetrics().lcp).toBe(3000)
      expect(trackCalls('performance_lcp')).toEqual([{ value: 3000, rating: 'needs-improvement' }])
    })

    it('records FID as processingStart - startTime', () => {
      FakePerformanceObserver.emit('first-input', [{ startTime: 100, processingStart: 150 }])
      expect(pt.getMetrics().fid).toBe(50)
      expect(trackCalls('performance_fid')).toEqual([{ value: 50, rating: 'good' }])
    })

    it('accumulates CLS and ignores shifts with recent input', () => {
      FakePerformanceObserver.emit('layout-shift', [
        { value: 0.05, hadRecentInput: false },
        { value: 0.5, hadRecentInput: true },
      ])
      FakePerformanceObserver.emit('layout-shift', [{ value: 0.25, hadRecentInput: false }])

      expect(pt.getMetrics().cls).toBeCloseTo(0.3)
      const calls = trackCalls('performance_cls')
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ value: 0.05, rating: 'good' })
      expect(calls[1]?.rating).toBe('poor')
    })

    it('records FCP only for the first-contentful-paint entry', () => {
      FakePerformanceObserver.emit('paint', [
        { name: 'first-paint', startTime: 500 },
        { name: 'first-contentful-paint', startTime: 1900 },
      ])
      expect(pt.getMetrics().fcp).toBe(1900)
      expect(trackCalls('performance_fcp')).toEqual([{ value: 1900, rating: 'needs-improvement' }])
    })
  })

  describe('navigation timing', () => {
    beforeEach(() => pt.startTracking())

    it('derives TTFB, DOMContentLoaded and load times', () => {
      FakePerformanceObserver.emit('navigation', [{
        fetchStart: 0,
        requestStart: 100,
        responseStart: 300,
        domContentLoadedEventEnd: 1500,
        loadEventEnd: 3500,
      }])

      expect(pt.getMetrics()).toMatchObject({
        ttfb: 200,
        domContentLoaded: 1500,
        loadComplete: 3500,
        totalLoadTime: 3500,
      })
      expect(trackCalls('performance_navigation')).toEqual([{
        ttfb: 200,
        domContentLoaded: 1500,
        loadComplete: 3500,
        totalLoadTime: 3500,
        ratings: { ttfb: 'good', domContentLoaded: 'good', totalLoadTime: 'needs-improvement' },
      }])
    })
  })

  describe('resource timing', () => {
    beforeEach(() => pt.startTracking())

    it('counts resources, sums transfer size and flags slow ones', () => {
      FakePerformanceObserver.emit('resource', [
        { name: 'https://x.test/app.js', transferSize: 1000, duration: 200, startTime: 10 },
        { name: 'https://x.test/api/users', transferSize: 500, duration: 1500, startTime: 20 },
        { name: 'https://x.test/cached.css', duration: 1001, startTime: 30 },
      ])

      const metrics = pt.getMetrics()
      expect(metrics.resourceCount).toBe(3)
      expect(metrics.totalResourceSize).toBe(1500)
      expect(metrics.slowResources).toEqual([
        { name: 'https://x.test/api/users', type: 'api', size: 500, duration: 1500, startTime: 20 },
        { name: 'https://x.test/cached.css', type: 'stylesheet', size: 0, duration: 1001, startTime: 30 },
      ])
      expect(trackCalls('performance_slow_resource')).toHaveLength(2)
    })

    it('does not flag a resource at exactly the 1s threshold', () => {
      FakePerformanceObserver.emit('resource', [{ name: 'a.png', duration: 1000, startTime: 0 }])
      expect(pt.getMetrics().slowResources).toBeUndefined()
    })

    it.each([
      ['https://x.test/main.js', 'script'],
      ['https://x.test/site.css', 'stylesheet'],
      ['https://x.test/logo.PNG', 'image'],
      ['https://x.test/font.woff2', 'font'],
      ['https://x.test/api/items', 'api'],
      ['https://x.test/page', 'other'],
      // Current behaviour: substring checks match ".json" as a script and
      // the anchored image regex misses URLs with a query string.
      ['https://x.test/data.json', 'script'],
      ['https://x.test/photo.jpg?w=200', 'other'],
    ])('classifies %s as %s', (name, type) => {
      FakePerformanceObserver.emit('resource', [{ name, duration: 2000, startTime: 0 }])
      expect(pt.getMetrics().slowResources?.[0]?.type).toBe(type)
    })
  })

  describe('user interactions', () => {
    it('records only the first interaction across event types', () => {
      pt.startTracking()
      listeners.click[0]({ timeStamp: 1234 } as Event)
      listeners.scroll[0]({ timeStamp: 5000 } as Event)

      expect(pt.getMetrics().firstInteraction).toBe(1234)
      // firstInteraction has no threshold, so it is always rated "unknown"
      expect(trackCalls('performance_first_interaction')).toEqual([{ value: 1234, rating: 'unknown' }])
    })
  })

  describe('page load', () => {
    afterEach(() => {
      delete (performance as { timing?: unknown }).timing
    })

    it('tracks load time immediately when the document is already complete', () => {
      Object.defineProperty(performance, 'timing', {
        configurable: true,
        value: { navigationStart: 1000, loadEventEnd: 2500 },
      })
      pt.startTracking()

      expect(pt.getMetrics().totalLoadTime).toBe(1500)
      expect(trackCalls('page_load_complete')).toEqual([{
        loadTime: 1500,
        rating: 'good',
        url: globalThis.location.href,
        userAgent: globalThis.navigator.userAgent,
      }])
      expect(listeners.load).toBeUndefined()
    })

    it('defers to the load event while the document is still loading', () => {
      vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
      Object.defineProperty(performance, 'timing', {
        configurable: true,
        value: { navigationStart: 0, loadEventEnd: 6000 },
      })
      pt.startTracking()
      expect(trackCalls('page_load_complete')).toHaveLength(0)

      listeners.load[0](new Event('load'))
      expect(trackCalls('page_load_complete')[0]).toMatchObject({ loadTime: 6000, rating: 'poor' })
    })

    it('skips page load tracking when performance.timing is unavailable', () => {
      pt.startTracking()
      expect(trackCalls('page_load_complete')).toHaveLength(0)
    })
  })

  describe('custom metrics', () => {
    it.each([
      [1000, 'good'],
      [1001, 'needs-improvement'],
      [3000, 'needs-improvement'],
      [3001, 'poor'],
    ])('rates %d as %s', (value, rating) => {
      pt.trackCustomMetric('render', value)
      expect(pt.getMetrics().customMetrics).toEqual({ render: value })
      expect(trackCalls('performance_custom_metric')).toEqual([{ name: 'render', value, unit: 'ms', rating }])
    })

    it('passes through a custom unit', () => {
      pt.trackCustomMetric('bundle', 12, 'kb')
      expect(trackCalls('performance_custom_metric')[0]).toMatchObject({ unit: 'kb' })
    })
  })

  describe('getMetrics', () => {
    it('returns a shallow copy', () => {
      pt.trackCustomMetric('a', 1)
      const metrics = pt.getMetrics()
      metrics.lcp = 99
      expect(pt.getMetrics().lcp).toBeUndefined()
    })
  })

  describe('getPerformanceScore', () => {
    beforeEach(() => pt.startTracking())

    it('scores 100 everywhere with no data', () => {
      expect(pt.getPerformanceScore()).toEqual({
        overall: 100,
        categories: { coreWebVitals: 100, loading: 100, interactivity: 100, resources: 100 },
        recommendations: [],
      })
    })

    it('averages good / needs-improvement / poor ratings per category', () => {
      FakePerformanceObserver.emit('paint', [{ name: 'first-contentful-paint', startTime: 1000 }]) // good
      FakePerformanceObserver.emit('largest-contentful-paint', [{ startTime: 3000 }]) // needs-improvement
      FakePerformanceObserver.emit('first-input', [{ startTime: 0, processingStart: 500 }]) // poor

      const { categories } = pt.getPerformanceScore()
      expect(categories.coreWebVitals).toBe((100 + 60 + 20) / 3)
    })

    it('scores an unrated interaction metric as 50', () => {
      listeners.click[0]({ timeStamp: 10 } as Event)
      const score = pt.getPerformanceScore()
      expect(score.categories.interactivity).toBe(50)
      expect(score.overall).toBe((100 + 100 + 50 + 100) / 4)
    })

    it.each([
      [1, 10, 100],
      [2, 10, 70],
      [3, 10, 70],
      [4, 10, 40],
    ])('scores %d slow of %d resources as %d', (slow, total, expected) => {
      const entries = Array.from({ length: total }, (_, i) => ({
        name: `r${i}`,
        duration: i < slow ? 2000 : 10,
        startTime: 0,
      }))
      FakePerformanceObserver.emit('resource', entries)
      expect(pt.getPerformanceScore().categories.resources).toBe(expected)
    })

    it('recommends fixes for poor and borderline metrics, slow and heavy resources', () => {
      FakePerformanceObserver.emit('largest-contentful-paint', [{ startTime: 5000 }])
      FakePerformanceObserver.emit('paint', [{ name: 'first-contentful-paint', startTime: 2000 }])
      FakePerformanceObserver.emit('resource', [{ name: 'big.js', transferSize: 3_000_001, duration: 1500, startTime: 0 }])

      expect(pt.getPerformanceScore().recommendations).toEqual([
        'Consider improving fcp (2000ms is above 1800ms)',
        'Optimize lcp (5000ms exceeds 4000ms)',
        '1 slow resources detected - consider optimizing or lazy loading',
        'Large total resource size - consider compressing assets',
      ])
    })
  })

  describe('reset and export', () => {
    it('reset clears metrics and disconnects observers', () => {
      pt.startTracking()
      pt.trackCustomMetric('a', 1)
      pt.reset()

      expect(pt.getMetrics()).toEqual({})
      FakePerformanceObserver.instances.forEach(o => expect(o.disconnect).toHaveBeenCalled())
    })

    it('exportMetrics serialises metrics, score, timestamp and url', () => {
      vi.spyOn(Date, 'now').mockReturnValue(42)
      pt.trackCustomMetric('a', 1)

      const exported = JSON.parse(pt.exportMetrics())
      expect(exported).toEqual({
        metrics: { customMetrics: { a: 1 } },
        score: pt.getPerformanceScore(),
        timestamp: 42,
        url: globalThis.location.href,
      })
    })
  })
})
