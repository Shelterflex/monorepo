import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../analytics', () => ({
  analytics: {
    startFunnel: vi.fn(),
    trackFunnelStep: vi.fn(),
    completeFunnel: vi.fn(),
    track: vi.fn(),
  },
}))

import FunnelAnalysis, { funnelAnalysis } from '../funnel-analysis'
import { analytics } from '../analytics'

const THREE_STEP = {
  name: 'checkout',
  description: 'Test checkout funnel',
  steps: [
    { name: 'cart', description: 'View cart', required: true },
    { name: 'details', description: 'Enter details', required: true },
    { name: 'pay', description: 'Pay', required: true },
  ],
}

describe('FunnelAnalysis', () => {
  let fa: FunnelAnalysis
  let now: number

  beforeEach(() => {
    vi.clearAllMocks()
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fa = new FunnelAnalysis()
    fa.defineFunnel(THREE_STEP)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('funnel definitions', () => {
    it('registers the six default funnels on construction', () => {
      const names = new FunnelAnalysis().getAllFunnelDefinitions().map(f => f.name)
      expect(names).toEqual([
        'user_registration',
        'property_discovery',
        'rental_application',
        'payment_setup',
        'staking_investment',
        'whistleblower_report',
      ])
    })

    it('defines and retrieves a custom funnel', () => {
      expect(fa.getFunnelDefinition('checkout')).toEqual(THREE_STEP)
      expect(fa.getAllFunnelDefinitions()).toHaveLength(7)
    })

    it('returns undefined for an unknown funnel', () => {
      expect(fa.getFunnelDefinition('nope')).toBeUndefined()
    })

    it('replaces an existing definition with the same name', () => {
      fa.defineFunnel({ ...THREE_STEP, description: 'v2' })
      expect(fa.getFunnelDefinition('checkout')?.description).toBe('v2')
      expect(fa.getAllFunnelDefinitions()).toHaveLength(7)
    })

    it('exposes a singleton instance', () => {
      expect(FunnelAnalysis.getInstance()).toBe(funnelAnalysis)
    })
  })

  describe('tracking', () => {
    it('startFunnel records user state and forwards the first step to analytics', () => {
      fa.startFunnel('checkout', 'u1', { source: 'ad' })

      expect(fa.exportFunnelData('checkout')).toEqual({
        u1: {
          startedAt: 1_000_000,
          currentStep: 0,
          completedSteps: [],
          properties: { source: 'ad' },
          droppedAt: null,
        },
      })
      expect(analytics.startFunnel).toHaveBeenCalledWith('checkout', 'cart', { userId: 'u1', source: 'ad' })
    })

    it('startFunnel warns and does nothing for an undefined funnel', () => {
      fa.startFunnel('missing', 'u1')
      expect(console.warn).toHaveBeenCalledWith('Funnel "missing" not defined')
      expect(fa.exportFunnelData('missing')).toEqual({})
      expect(analytics.startFunnel).not.toHaveBeenCalled()
    })

    it('trackStep updates currentStep and appends a completed step', () => {
      fa.startFunnel('checkout', 'u1')
      now += 500
      fa.trackStep('checkout', 'u1', 'details', { field: 'x' })

      const data = fa.exportFunnelData('checkout').u1
      expect(data.currentStep).toBe(1)
      expect(data.completedSteps).toEqual([
        { step: 'details', completedAt: 1_000_500, properties: { field: 'x' } },
      ])
      expect(analytics.trackFunnelStep).toHaveBeenCalledWith('checkout', 'details', {
        userId: 'u1',
        stepNumber: 2,
        field: 'x',
      })
    })

    it('trackStep sets currentStep to the tracked index even when moving backwards', () => {
      fa.startFunnel('checkout', 'u1')
      fa.trackStep('checkout', 'u1', 'pay')
      fa.trackStep('checkout', 'u1', 'cart')
      expect(fa.exportFunnelData('checkout').u1.currentStep).toBe(0)
    })

    it('trackStep warns for an unknown funnel, unstarted user, or unknown step', () => {
      fa.trackStep('missing', 'u1', 'cart')
      fa.trackStep('checkout', 'u1', 'cart')
      fa.startFunnel('checkout', 'u1')
      fa.trackStep('checkout', 'u1', 'bogus')

      expect(console.warn).toHaveBeenCalledWith('Funnel "missing" not defined')
      expect(console.warn).toHaveBeenCalledWith('User "u1" not started funnel "checkout"')
      expect(console.warn).toHaveBeenCalledWith('Step "bogus" not found in funnel "checkout"')
      expect(fa.exportFunnelData('checkout').u1.completedSteps).toEqual([])
      expect(analytics.trackFunnelStep).not.toHaveBeenCalled()
    })

    it('completeFunnel stamps completedAt and reports total time', () => {
      fa.startFunnel('checkout', 'u1')
      now += 2_000
      fa.completeFunnel('checkout', 'u1', { plan: 'pro' })

      expect(fa.exportFunnelData('checkout').u1.completedAt).toBe(1_002_000)
      expect(analytics.completeFunnel).toHaveBeenCalledWith('checkout', {
        userId: 'u1',
        totalTime: 2_000,
        plan: 'pro',
      })
    })

    it('completeFunnel warns for an unknown funnel or unstarted user', () => {
      fa.completeFunnel('missing', 'u1')
      fa.completeFunnel('checkout', 'u1')
      expect(console.warn).toHaveBeenCalledTimes(2)
      expect(analytics.completeFunnel).not.toHaveBeenCalled()
    })

    it('dropOff records the time and reason', () => {
      fa.startFunnel('checkout', 'u1')
      fa.trackStep('checkout', 'u1', 'details')
      now += 100
      fa.dropOff('checkout', 'u1', 'too_long')

      const data = fa.exportFunnelData('checkout').u1
      expect(data.droppedAt).toBe(1_000_100)
      expect(data.dropOffReason).toBe('too_long')
      expect(analytics.track).toHaveBeenCalledWith('funnel_dropoff', {
        funnel: 'checkout',
        userId: 'u1',
        currentStep: 1,
        reason: 'too_long',
      })
    })

    it('dropOff reports "unknown" when no reason is given', () => {
      fa.startFunnel('checkout', 'u1')
      fa.dropOff('checkout', 'u1')
      expect(analytics.track).toHaveBeenCalledWith('funnel_dropoff', expect.objectContaining({ reason: 'unknown' }))
    })

    it('dropOff silently ignores users who never started the funnel', () => {
      fa.dropOff('checkout', 'ghost')
      expect(analytics.track).not.toHaveBeenCalled()
      expect(console.warn).not.toHaveBeenCalled()
    })
  })

  describe('getFunnelAnalytics', () => {
    it('returns null for an unknown funnel', () => {
      expect(fa.getFunnelAnalytics('missing')).toBeNull()
    })

    it('returns null for a defined funnel with no users', () => {
      expect(fa.getFunnelAnalytics('checkout')).toBeNull()
    })

    it('computes per-step users, conversion rate, drop-off rate and average time', () => {
      // u1 reaches every step and completes
      fa.startFunnel('checkout', 'u1')
      now += 1_000
      fa.trackStep('checkout', 'u1', 'cart')
      now += 1_000
      fa.trackStep('checkout', 'u1', 'details')
      now += 1_000
      fa.trackStep('checkout', 'u1', 'pay')
      fa.completeFunnel('checkout', 'u1')

      // u2 starts at the same moment as u1 finishes, reaches "details", then drops
      fa.startFunnel('checkout', 'u2')
      now += 4_000
      fa.trackStep('checkout', 'u2', 'details')
      fa.dropOff('checkout', 'u2', 'price')

      // u3 starts and does nothing else
      fa.startFunnel('checkout', 'u3')

      const result = fa.getFunnelAnalytics('checkout')!
      expect(result.name).toBe('checkout')
      expect(result.totalUsers).toBe(3)
      expect(result.conversionRate).toBeCloseTo(1 / 3)
      expect(result.averageTime).toBe(3_000)

      const [cart, details, pay] = result.stepAnalytics
      expect(cart).toEqual({
        stepName: 'cart',
        stepNumber: 1,
        users: 3, // every started user has currentStep >= 0
        conversionRate: 1,
        averageTime: 1_000 / 3, // only u1 has a timing for "cart"
        dropOffRate: 1 / 3,
      })
      expect(details).toEqual({
        stepName: 'details',
        stepNumber: 2,
        users: 2,
        conversionRate: 2 / 3,
        averageTime: (2_000 + 4_000) / 2,
        dropOffRate: 1 / 2,
      })
      expect(pay).toEqual({
        stepName: 'pay',
        stepNumber: 3,
        users: 1,
        conversionRate: 1 / 3,
        averageTime: 3_000,
        dropOffRate: 1, // last step: nobody can be "at step + 1"
      })
    })

    it('reports drop-off points with de-duplicated reasons', () => {
      for (const id of ['a', 'b', 'c']) {
        fa.startFunnel('checkout', id)
        fa.trackStep('checkout', id, 'details')
      }
      fa.dropOff('checkout', 'a', 'price')
      fa.dropOff('checkout', 'b', 'price')
      fa.dropOff('checkout', 'c')
      fa.startFunnel('checkout', 'd')
      fa.dropOff('checkout', 'd', 'bored')

      const result = fa.getFunnelAnalytics('checkout')!
      expect(result.dropOffPoints).toEqual([
        { stepName: 'cart', stepNumber: 1, dropOffCount: 1, dropOffRate: 1 / 4, reasons: ['bored'] },
        { stepName: 'details', stepNumber: 2, dropOffCount: 3, dropOffRate: 1, reasons: ['price', 'unknown'] },
      ])
    })

    it('has no drop-off points when every user reaches the last step', () => {
      fa.startFunnel('checkout', 'u1')
      fa.trackStep('checkout', 'u1', 'pay')
      expect(fa.getFunnelAnalytics('checkout')!.dropOffPoints).toEqual([])
    })

    it('reports zero overall conversion and average time when nobody completes', () => {
      fa.startFunnel('checkout', 'u1')
      const result = fa.getFunnelAnalytics('checkout')!
      expect(result.conversionRate).toBe(0)
      expect(result.averageTime).toBe(0)
    })

    it('handles steps completed with no time gap', () => {
      fa.startFunnel('checkout', 'u1')
      fa.trackStep('checkout', 'u1', 'cart')
      fa.trackStep('checkout', 'u1', 'details')
      fa.trackStep('checkout', 'u1', 'pay')
      fa.completeFunnel('checkout', 'u1')

      const result = fa.getFunnelAnalytics('checkout')!
      expect(result.averageTime).toBe(0)
      expect(result.stepAnalytics.map(s => s.averageTime)).toEqual([0, 0, 0])
      expect(result.conversionRate).toBe(1)
    })

    // Documents current behaviour: a step no user has reached yields 0 / 0.
    it('returns NaN dropOffRate for a step with zero users', () => {
      fa.startFunnel('checkout', 'u1')
      const pay = fa.getFunnelAnalytics('checkout')!.stepAnalytics[2]
      expect(pay.users).toBe(0)
      expect(pay.conversionRate).toBe(0)
      expect(pay.averageTime).toBe(0)
      expect(pay.dropOffRate).toBeNaN()
    })

    it('handles a single-step funnel', () => {
      fa.defineFunnel({
        name: 'single',
        description: 'One step',
        steps: [{ name: 'only', description: 'Only step', required: true }],
      })
      fa.startFunnel('single', 'u1')
      now += 250
      fa.trackStep('single', 'u1', 'only')
      fa.completeFunnel('single', 'u1')

      const result = fa.getFunnelAnalytics('single')!
      expect(result.stepAnalytics).toEqual([
        { stepName: 'only', stepNumber: 1, users: 1, conversionRate: 1, averageTime: 250, dropOffRate: 1 },
      ])
      expect(result.dropOffPoints).toEqual([])
      expect(result.conversionRate).toBe(1)
      expect(result.averageTime).toBe(250)
    })

    // Documents current behaviour: startFunnel reads steps[0].name unguarded.
    it('throws when starting a funnel with no steps', () => {
      fa.defineFunnel({ name: 'empty', description: 'No steps', steps: [] })
      expect(() => fa.startFunnel('empty', 'u1')).toThrow(TypeError)
      expect(fa.getFunnelAnalytics('empty')).toEqual({
        name: 'empty',
        totalUsers: 1,
        stepAnalytics: [],
        conversionRate: 0,
        averageTime: 0,
        dropOffPoints: [],
      })
    })

    it('getAllFunnelAnalytics only includes funnels with data', () => {
      fa.startFunnel('checkout', 'u1')
      const all = fa.getAllFunnelAnalytics()
      expect([...all.keys()]).toEqual(['checkout'])
    })
  })

  describe('getOptimizationInsights', () => {
    it('returns empty insights for a funnel with no data', () => {
      expect(fa.getOptimizationInsights('checkout')).toEqual({
        issues: [],
        recommendations: [],
        topDropOffPoints: [],
      })
    })

    it('flags high drop-off, low conversion and long completion time', () => {
      for (let i = 0; i < 11; i++) fa.startFunnel('checkout', `u${i}`)
      fa.trackStep('checkout', 'u0', 'pay')
      now += 400_000
      fa.completeFunnel('checkout', 'u0')

      const { issues, recommendations, topDropOffPoints } = fa.getOptimizationInsights('checkout')
      expect(issues).toEqual([
        'High drop-off rate (90.9%) at step: cart',
        'High drop-off rate (100.0%) at step: pay',
        'Low overall conversion rate (9.1%)',
        'Long average completion time (6.7 minutes)',
      ])
      expect(recommendations).toHaveLength(4)
      expect(topDropOffPoints.map(p => p.stepName)).toEqual(['cart'])
    })

    it('returns at most three drop-off points sorted by rate', () => {
      fa.defineFunnel({
        name: 'long',
        description: 'Five steps',
        steps: ['s1', 's2', 's3', 's4', 's5'].map(name => ({ name, description: name, required: true })),
      })
      // 10 users; how far each gets (step index)
      const reached = [0, 1, 1, 2, 2, 2, 3, 3, 3, 4]
      reached.forEach((idx, i) => {
        fa.startFunnel('long', `u${i}`)
        fa.trackStep('long', `u${i}`, `s${idx + 1}`)
      })

      const top = fa.getOptimizationInsights('long').topDropOffPoints
      expect(top).toHaveLength(3)
      const rates = top.map(p => p.dropOffRate)
      expect(rates).toEqual([...rates].sort((a, b) => b - a))
      expect(top[0]).toMatchObject({ stepName: 's4', dropOffRate: 3 / 4 })
    })
  })

  describe('export and clear', () => {
    it('exports all funnels keyed by name', () => {
      fa.startFunnel('checkout', 'u1')
      fa.startFunnel('payment_setup', 'u2')
      const all = fa.exportFunnelData()
      expect(Object.keys(all)).toEqual(['checkout', 'payment_setup'])
      expect(Object.keys(all.checkout)).toEqual(['u1'])
    })

    it('clears a single funnel or all funnels', () => {
      fa.startFunnel('checkout', 'u1')
      fa.startFunnel('payment_setup', 'u2')

      fa.clearFunnelData('checkout')
      expect(fa.getFunnelAnalytics('checkout')).toBeNull()
      expect(fa.getFunnelAnalytics('payment_setup')).not.toBeNull()

      fa.clearFunnelData()
      expect(fa.exportFunnelData()).toEqual({})
    })
  })
})
