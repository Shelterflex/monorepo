import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Analytics, { analytics as analyticsSingleton } from '../analytics'

const FULL_CONSENT = { analytics: true, performance: false, functional: false, marketing: false }

// Build a fresh instance whose constructor sees the given persisted state.
function makeAnalytics(stored: { consent?: object; userId?: string } = {}) {
  if (stored.consent) localStorage.setItem('analytics_consent', JSON.stringify(stored.consent))
  if (stored.userId) localStorage.setItem('analytics_user_id', stored.userId)
  return new Analytics()
}

function initialized() {
  const a = makeAnalytics()
  a.setConsent({ analytics: true })
  return a
}

describe('Analytics', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('exposes a singleton instance', () => {
    expect(Analytics.getInstance()).toBe(analyticsSingleton)
  })

  describe('consent', () => {
    it('defaults every category to false', () => {
      const a = makeAnalytics()
      expect(a.getConsent()).toEqual({ analytics: false, performance: false, functional: false, marketing: false })
      expect(a.hasConsent('analytics')).toBe(false)
    })

    it('loads persisted consent on construction', () => {
      const a = makeAnalytics({ consent: { ...FULL_CONSENT, marketing: true } })
      expect(a.hasConsent('analytics')).toBe(true)
      expect(a.hasConsent('marketing')).toBe(true)
    })

    it('warns and keeps defaults when persisted consent is malformed', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      localStorage.setItem('analytics_consent', '{not json')
      const a = new Analytics()
      expect(a.hasConsent('analytics')).toBe(false)
      expect(warn).toHaveBeenCalledWith('Failed to load consent settings:', expect.any(SyntaxError))
    })

    it('merges partial updates and persists them', () => {
      const a = makeAnalytics()
      a.setConsent({ performance: true })
      a.setConsent({ marketing: true })
      expect(a.getConsent()).toEqual({ analytics: false, performance: true, functional: false, marketing: true })
      expect(JSON.parse(localStorage.getItem('analytics_consent')!)).toEqual(a.getConsent())
    })

    it('getConsent returns a copy', () => {
      const a = makeAnalytics()
      a.getConsent().analytics = true
      expect(a.hasConsent('analytics')).toBe(false)
    })

    it('initializes (page view + session start) when analytics consent is granted', () => {
      const a = initialized()
      expect(a.getEvents().map(e => e.event)).toEqual(['page_view', 'session_start'])
    })

    it('does not re-initialize on later consent changes', () => {
      const a = initialized()
      a.setConsent({ marketing: true })
      a.initialize()
      expect(a.getEvents('session_start')).toHaveLength(1)
    })
  })

  describe('track', () => {
    it('drops events without analytics consent', () => {
      const a = makeAnalytics()
      a.track('click')
      expect(a.getEvents()).toEqual([])
    })

    it('drops events when consent was persisted but initialize() was never called', () => {
      const a = makeAnalytics({ consent: FULL_CONSENT })
      a.track('click')
      a.initialize()
      expect(a.getEvents('click')).toEqual([])
    })

    it('records event metadata', () => {
      const a = initialized()
      a.track('button_click', { label: 'Buy' })

      const [event] = a.getEvents('button_click')
      expect(event).toEqual({
        event: 'button_click',
        properties: { label: 'Buy' },
        timestamp: 1_700_000_000_000,
        sessionId: expect.stringMatching(/^session_1700000000000_[a-z0-9]+$/),
        userId: undefined,
        page: globalThis.location.pathname,
        referrer: document.referrer,
        userAgent: navigator.userAgent,
      })
    })

    it('normalises event names to lowercase snake case', () => {
      const a = initialized()
      a.track('Checkout Started!')
      expect(a.getEvents().at(-1)?.event).toBe('checkout_started_')
    })

    it('forwards events to Vercel Analytics when window.va exists', () => {
      const va = vi.fn()
      vi.stubGlobal('va', va)
      const a = initialized()
      a.track('signup', { plan: 'pro' })
      expect(va).toHaveBeenCalledWith('track', 'signup', { plan: 'pro' })
    })

    it('swallows errors from Vercel Analytics', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubGlobal('va', () => {
        throw new Error('boom')
      })
      const a = initialized()
      a.track('signup')
      await Promise.resolve()
      expect(a.getEvents('signup')).toHaveLength(1)
      expect(warn).toHaveBeenCalledWith('Failed to send analytics event:', expect.any(Error))
    })

    it('trims the local buffer to the last 500 once it exceeds 1000 events', () => {
      const a = initialized() // 2 events already
      for (let i = 0; i < 998; i++) a.track('e', { i })
      expect(a.getEvents()).toHaveLength(1000)

      a.track('e', { i: 998 })
      const events = a.getEvents()
      expect(events).toHaveLength(500)
      expect(events.at(-1)?.properties).toEqual({ i: 998 })
    })
  })

  describe('property sanitisation', () => {
    const tracked = (props: Record<string, unknown>) => {
      const a = initialized()
      a.track('e', props)
      return a.getEvents('e')[0].properties
    }

    it('strips sensitive keys (case-insensitive substring match)', () => {
      expect(tracked({
        password: 'x',
        accessToken: 'x',
        client_secret: 'x',
        apiKey: 'x',
        SSN: 'x',
        creditScore: 700,
        cardLast4: '4242',
        // substring match also drops harmless keys
        keyword: 'rent',
        safe: 'ok',
      })).toEqual({ safe: 'ok' })
    })

    it('removes angle brackets and truncates strings to 500 chars', () => {
      const props = tracked({ html: '<b>hi</b>', long: 'a'.repeat(600) })!
      expect(props.html).toBe('bhi/b')
      expect(props.long).toHaveLength(500)
    })

    it('keeps finite numbers and booleans, drops non-finite numbers, null and undefined', () => {
      expect(tracked({ n: 1.5, zero: 0, flag: false, inf: Infinity, nan: NaN, nil: null, undef: undefined }))
        .toEqual({ n: 1.5, zero: 0, flag: false })
    })

    it('limits arrays to 10 items and replaces objects with up to 10 of their keys', () => {
      const obj = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i]))
      const props = tracked({ list: Array.from({ length: 15 }, (_, i) => i), obj })!
      expect(props.list).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      expect(props.obj).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'])
    })

    it('leaves properties undefined when none are given', () => {
      const a = initialized()
      a.track('bare')
      expect(a.getEvents('bare')[0].properties).toBeUndefined()
    })
  })

  describe('identify', () => {
    it('is ignored without consent', () => {
      const a = makeAnalytics()
      a.identify('u1')
      expect(localStorage.getItem('analytics_user_id')).toBeNull()
    })

    it('stores the user id, persists it and attaches it to later events', () => {
      const a = initialized()
      a.identify('u1', { plan: 'pro', password: 'x' })

      expect(localStorage.getItem('analytics_user_id')).toBe('u1')
      const [identified] = a.getEvents('user_identified')
      expect(identified.properties).toEqual({ userId: 'u1', traits: ['plan'] })
      expect(identified.userId).toBe('u1')
    })

    it('restores a persisted user id on construction', () => {
      const a = makeAnalytics({ userId: 'returning' })
      a.setConsent({ analytics: true })
      expect(a.getEvents()[0].userId).toBe('returning')
    })
  })

  describe('trackPageView', () => {
    it('uses the explicit path or falls back to location.pathname', () => {
      const a = initialized()
      a.trackPageView('/properties')
      const views = a.getEvents('page_view')
      expect(views[0].properties?.page).toBe(globalThis.location.pathname)
      expect(views[1].properties).toEqual({ page: '/properties', title: document.title, referrer: document.referrer })
    })
  })

  describe('funnels', () => {
    it('ignores funnel calls without consent', () => {
      const a = makeAnalytics()
      a.startFunnel('signup', 'visit')
      expect(a.getFunnelData('signup')).toBeNull()
    })

    it('startFunnel records step 1 and emits funnel_start', () => {
      const a = initialized()
      a.startFunnel('signup', 'visit', { source: 'ad' })

      expect(a.getFunnelData('signup')).toEqual([{ name: 'visit', step: 1, properties: { source: 'ad' } }])
      expect(a.getEvents('funnel_start')[0].properties).toEqual({
        funnel: 'signup', step: 'visit', stepNumber: 1, source: 'ad',
      })
    })

    it('trackFunnelStep numbers steps sequentially', () => {
      const a = initialized()
      a.startFunnel('signup', 'visit')
      a.trackFunnelStep('signup', 'form')
      a.trackFunnelStep('signup', 'verify', { completed: true })

      expect(a.getFunnelData('signup')?.map(s => [s.name, s.step])).toEqual([['visit', 1], ['form', 2], ['verify', 3]])
      expect(a.getEvents('funnel_step').map(e => e.properties)).toEqual([
        { funnel: 'signup', step: 'form', stepNumber: 2, totalSteps: 2 },
        { funnel: 'signup', step: 'verify', stepNumber: 3, totalSteps: 3, completed: true },
      ])
    })

    it('trackFunnelStep and completeFunnel warn when the funnel was not started', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const a = initialized()
      a.trackFunnelStep('nope', 'x')
      a.completeFunnel('nope')
      expect(warn).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenCalledWith('Funnel "nope" not started')
      expect(a.getEvents('funnel_step')).toEqual([])
      expect(a.getEvents('funnel_complete')).toEqual([])
    })

    it('completeFunnel emits funnel_complete and clears the funnel', () => {
      const a = initialized()
      a.startFunnel('signup', 'visit')
      a.trackFunnelStep('signup', 'form')
      a.completeFunnel('signup', { plan: 'basic' })

      expect(a.getEvents('funnel_complete')[0].properties).toEqual({
        funnel: 'signup',
        totalSteps: 2,
        // No `timestamp` was passed to startFunnel, so this is Date.now() - Date.now()
        completionTime: 0,
        plan: 'basic',
      })
      expect(a.getFunnelData('signup')).toBeNull()
    })

    it('completeFunnel measures from a timestamp passed to startFunnel', () => {
      const a = initialized()
      a.startFunnel('signup', 'visit', { timestamp: 1_700_000_000_000 - 5_000 })
      a.completeFunnel('signup')
      expect(a.getEvents('funnel_complete')[0].properties?.completionTime).toBe(5_000)
    })

    it('restarting a funnel replaces its steps', () => {
      const a = initialized()
      a.startFunnel('signup', 'visit')
      a.trackFunnelStep('signup', 'form')
      a.startFunnel('signup', 'visit')
      expect(a.getFunnelData('signup')).toHaveLength(1)
    })

    describe('getFunnelAnalytics', () => {
      it('returns null for an unknown funnel', () => {
        expect(initialized().getFunnelAnalytics('nope')).toBeNull()
      })

      it('counts steps flagged completed', () => {
        const a = initialized()
        a.startFunnel('signup', 'visit', { completed: true })
        a.trackFunnelStep('signup', 'form')
        a.trackFunnelStep('signup', 'verify', { completed: true })
        a.trackFunnelStep('signup', 'done', { completed: false })

        expect(a.getFunnelAnalytics('signup')).toMatchObject({
          totalSteps: 4,
          completedSteps: 2,
          conversionRate: 0.5,
        })
      })

      it('reports zero conversion when no step is flagged completed', () => {
        const a = initialized()
        a.startFunnel('signup', 'visit')
        expect(a.getFunnelAnalytics('signup')).toMatchObject({ totalSteps: 1, completedSteps: 0, conversionRate: 0 })
      })
    })
  })

  describe('performance metrics', () => {
    type Callback = (list: { getEntries: () => unknown[] }) => void
    let callback: Callback | undefined
    let observedTypes: string[] | undefined

    beforeEach(() => {
      callback = undefined
      observedTypes = undefined
      vi.stubGlobal('PerformanceObserver', class {
        constructor(cb: Callback) {
          callback = cb
        }
        observe(opts: { entryTypes: string[] }) {
          observedTypes = opts.entryTypes
        }
      })
    })

    it('does not observe without performance consent', () => {
      initialized()
      expect(callback).toBeUndefined()
    })

    it('observes vitals once initialized with performance consent', () => {
      const a = makeAnalytics()
      a.setConsent({ performance: true })
      a.setConsent({ analytics: true })
      expect(observedTypes).toEqual(['navigation', 'paint', 'largest-contentful-paint', 'first-input', 'layout-shift'])

      callback!({
        getEntries: () => [
          { entryType: 'navigation', fetchStart: 0, requestStart: 100, responseStart: 250, domContentLoadedEventStart: 900, domContentLoadedEventEnd: 1000, loadEventStart: 1900, loadEventEnd: 2000 },
          { entryType: 'paint', name: 'first-contentful-paint', startTime: 800 },
          { entryType: 'largest-contentful-paint', startTime: 1200 },
          { entryType: 'first-input', startTime: 10, processingStart: 40 },
          { entryType: 'layout-shift', value: 0.1, hadRecentInput: false },
          { entryType: 'layout-shift', value: 0.9, hadRecentInput: true },
          { entryType: 'resource' },
        ],
      })

      expect(a.getEvents().filter(e => e.event.startsWith('performance_')).map(e => [e.event, e.properties])).toEqual([
        // `fcp` here is loadEventEnd - loadEventStart (current behaviour)
        ['performance_navigation', { fcp: 100, ttfb: 150, domLoad: 100, loadTime: 2000 }],
        ['performance_paint', { name: 'first-contentful-paint', value: 800 }],
        ['performance_lcp', { value: 1200 }],
        ['performance_fid', { value: 30 }],
        ['performance_cls', { value: 0.1 }],
      ])
    })

    it('warns when the observer cannot be created', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubGlobal('PerformanceObserver', class {
        constructor() {
          throw new Error('unsupported')
        }
      })
      const a = makeAnalytics()
      a.setConsent({ performance: true, analytics: true })
      expect(warn).toHaveBeenCalledWith('Performance observer setup failed:', expect.any(Error))
      expect(a.getEvents('session_start')).toHaveLength(1)
    })
  })

  describe('getEvents', () => {
    it('filters by event type and returns a copy', () => {
      const a = initialized()
      a.track('a')
      a.track('b')
      expect(a.getEvents('a')).toHaveLength(1)
      a.getEvents().length = 0
      expect(a.getEvents()).toHaveLength(4)
    })

    it('returns nothing once analytics consent is revoked', () => {
      const a = initialized()
      a.setConsent({ analytics: false })
      expect(a.getEvents()).toEqual([])
    })
  })

  describe('reset', () => {
    it('clears events, funnels and user id, and starts a new session', () => {
      const a = initialized()
      a.identify('u1')
      a.startFunnel('signup', 'visit')
      const oldSession = a.getEvents()[0].sessionId

      vi.mocked(Date.now).mockReturnValue(1_800_000_000_000)
      a.reset()

      expect(a.getEvents()).toEqual([])
      expect(a.getFunnelData('signup')).toBeNull()
      expect(localStorage.getItem('analytics_user_id')).toBeNull()

      // Consent is kept, so re-initializing works and uses a fresh session
      a.initialize()
      const [first] = a.getEvents()
      expect(first.sessionId).not.toBe(oldSession)
      expect(first.userId).toBeUndefined()
    })
  })
})
