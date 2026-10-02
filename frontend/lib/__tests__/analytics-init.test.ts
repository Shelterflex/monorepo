import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/analytics', () => ({
  analytics: {
    setConsent: vi.fn(),
    initialize: vi.fn(),
    track: vi.fn(),
    trackPageView: vi.fn(),
    getEvents: vi.fn().mockReturnValue([]),
    reset: vi.fn(),
  },
}))

vi.mock('@/lib/funnel-analysis', () => ({
  funnelAnalysis: {
    startFunnel: vi.fn(),
    trackStep: vi.fn(),
    completeFunnel: vi.fn(),
    dropOff: vi.fn(),
    getAllFunnelAnalytics: vi.fn().mockReturnValue(new Map()),
    getFunnelAnalytics: vi.fn().mockReturnValue({}),
    getOptimizationInsights: vi.fn().mockReturnValue([]),
  },
}))

vi.mock('@/lib/performance-tracking', () => ({
  performanceTracking: {
    startTracking: vi.fn(),
    stopTracking: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({}),
    getPerformanceScore: vi.fn().mockReturnValue(100),
    exportMetrics: vi.fn().mockReturnValue('{}'),
    trackCustomMetric: vi.fn(),
    reset: vi.fn(),
  },
}))

vi.mock('@/lib/consent-manager', () => ({
  consentManager: {
    initialize: vi.fn(),
    getPreferences: vi.fn(),
    hasConsent: vi.fn(),
    updatePreferences: vi.fn(),
    onConsentChange: vi.fn(() => vi.fn()),
  },
}))

import { analytics } from '@/lib/analytics'
import { funnelAnalysis } from '@/lib/funnel-analysis'
import { performanceTracking } from '@/lib/performance-tracking'
import { consentManager } from '@/lib/consent-manager'
import {
  initializeAnalytics,
  trackPageView,
  trackUserInteraction,
  trackFormSubmission,
  trackConversion,
  trackError,
  trackFeatureUsage,
  startUserRegistration,
  trackRegistrationStep,
  completeUserRegistration,
  startPropertyDiscovery,
  trackPropertyDiscoveryStep,
  startRentalApplication,
  trackRentalApplicationStep,
  startPaymentSetup,
  trackPaymentSetupStep,
  startStakingInvestment,
  trackStakingInvestmentStep,
  startWhistleblowerReport,
  trackWhistleblowerReportStep,
  trackCustomPerformanceMetric,
  updateConsent,
  getConsentStatus,
  exportAnalyticsData,
} from '@/lib/analytics-init'

const mockAnalytics = vi.mocked(analytics)
const mockFunnelAnalysis = vi.mocked(funnelAnalysis)
const mockPerformanceTracking = vi.mocked(performanceTracking)
const mockConsentManager = vi.mocked(consentManager)

describe('analytics-init', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initializeAnalytics', () => {
    it('initializes consent manager', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        performance: false,
        functional: false,
        marketing: false,
      })

      initializeAnalytics()

      expect(mockConsentManager.initialize).toHaveBeenCalled()
    })

    it('does not initialize analytics when no consent given', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        performance: false,
        functional: false,
        marketing: false,
      })

      initializeAnalytics()

      expect(mockAnalytics.setConsent).not.toHaveBeenCalled()
      expect(mockAnalytics.initialize).not.toHaveBeenCalled()
    })

    it('initializes analytics when analytics consent is given', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: Date.now(),
        version: '1.0',
        analytics: true,
        performance: false,
        functional: false,
        marketing: false,
      })

      initializeAnalytics()

      expect(mockAnalytics.setConsent).toHaveBeenCalledWith({ analytics: true })
      expect(mockAnalytics.initialize).toHaveBeenCalled()
    })

    it('tracks analytics initialization when consent is given', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: Date.now(),
        version: '1.0',
        analytics: true,
        performance: false,
        functional: false,
        marketing: false,
      })

      initializeAnalytics()

      expect(mockAnalytics.track).toHaveBeenCalledWith('analytics_initialized', expect.objectContaining({
        timestamp: expect.any(Number),
        consent: expect.any(Object),
        version: '1.0.0',
      }))
    })

    it('starts performance tracking when performance consent is given', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: Date.now(),
        version: '1.0',
        analytics: false,
        performance: true,
        functional: false,
        marketing: false,
      })

      initializeAnalytics()

      expect(mockPerformanceTracking.startTracking).toHaveBeenCalled()
    })

    it('initializes both analytics and performance when both consents are given', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: Date.now(),
        version: '1.0',
        analytics: true,
        performance: true,
        functional: false,
        marketing: false,
      })

      initializeAnalytics()

      expect(mockAnalytics.setConsent).toHaveBeenCalledWith({ analytics: true })
      expect(mockAnalytics.initialize).toHaveBeenCalled()
      expect(mockPerformanceTracking.startTracking).toHaveBeenCalled()
    })
  })

  describe('consent-gating behavior', () => {
    it('trackPageView respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      trackPageView('/test')

      expect(mockAnalytics.trackPageView).not.toHaveBeenCalled()
    })

    it('trackPageView calls analytics when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      trackPageView('/test')

      expect(mockAnalytics.trackPageView).toHaveBeenCalledWith('/test')
    })

    it('trackUserInteraction respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      trackUserInteraction('button_click', { buttonId: 'submit' })

      expect(mockAnalytics.track).not.toHaveBeenCalled()
    })

    it('trackUserInteraction calls analytics when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      trackUserInteraction('button_click', { buttonId: 'submit' })

      expect(mockAnalytics.track).toHaveBeenCalledWith('user_interaction', {
        action: 'button_click',
        buttonId: 'submit',
      })
    })

    it('trackFormSubmission respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      trackFormSubmission('contact_form', { field: 'email' })

      expect(mockAnalytics.track).not.toHaveBeenCalled()
    })

    it('trackFormSubmission calls analytics when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      trackFormSubmission('contact_form', { field: 'email' })

      expect(mockAnalytics.track).toHaveBeenCalledWith('form_submission', {
        formName: 'contact_form',
        field: 'email',
      })
    })

    it('trackConversion respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      trackConversion('signup', 100, { source: 'organic' })

      expect(mockAnalytics.track).not.toHaveBeenCalled()
    })

    it('trackConversion calls analytics when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      trackConversion('signup', 100, { source: 'organic' })

      expect(mockAnalytics.track).toHaveBeenCalledWith('conversion', {
        type: 'signup',
        value: 100,
        source: 'organic',
      })
    })

    it('trackError respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      trackError(new Error('test error'), { context: 'test' })

      expect(mockAnalytics.track).not.toHaveBeenCalled()
    })

    it('trackError calls analytics when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)
      const error = new Error('test error')

      trackError(error, { context: 'test' })

      expect(mockAnalytics.track).toHaveBeenCalledWith('error', {
        message: 'test error',
        stack: error.stack,
        context: 'test',
      })
    })

    it('trackFeatureUsage respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      trackFeatureUsage('search', { query: 'test' })

      expect(mockAnalytics.track).not.toHaveBeenCalled()
    })

    it('trackFeatureUsage calls analytics when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      trackFeatureUsage('search', { query: 'test' })

      expect(mockAnalytics.track).toHaveBeenCalledWith('feature_usage', {
        feature: 'search',
        query: 'test',
      })
    })

    it('trackCustomPerformanceMetric respects performance consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      trackCustomPerformanceMetric('custom_metric', 100, 'ms')

      expect(mockPerformanceTracking.trackCustomMetric).not.toHaveBeenCalled()
    })

    it('trackCustomPerformanceMetric calls performance tracking when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      trackCustomPerformanceMetric('custom_metric', 100, 'ms')

      expect(mockPerformanceTracking.trackCustomMetric).toHaveBeenCalledWith('custom_metric', 100, 'ms')
    })
  })

  describe('funnel tracking', () => {
    it('startUserRegistration respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      startUserRegistration('user-123')

      expect(mockFunnelAnalysis.startFunnel).not.toHaveBeenCalled()
    })

    it('startUserRegistration calls funnel analysis when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      startUserRegistration('user-123')

      expect(mockFunnelAnalysis.startFunnel).toHaveBeenCalledWith('user_registration', 'user-123')
    })

    it('trackRegistrationStep respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      trackRegistrationStep('user-123', 'email_verification')

      expect(mockFunnelAnalysis.trackStep).not.toHaveBeenCalled()
    })

    it('trackRegistrationStep calls funnel analysis when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      trackRegistrationStep('user-123', 'email_verification', { method: 'email' })

      expect(mockFunnelAnalysis.trackStep).toHaveBeenCalledWith('user_registration', 'user-123', 'email_verification', { method: 'email' })
    })

    it('completeUserRegistration respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      completeUserRegistration('user-123')

      expect(mockFunnelAnalysis.completeFunnel).not.toHaveBeenCalled()
    })

    it('completeUserRegistration calls funnel analysis when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      completeUserRegistration('user-123', { source: 'direct' })

      expect(mockFunnelAnalysis.completeFunnel).toHaveBeenCalledWith('user_registration', 'user-123', { source: 'direct' })
    })

    it('startPropertyDiscovery respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      startPropertyDiscovery('user-123')

      expect(mockFunnelAnalysis.startFunnel).not.toHaveBeenCalled()
    })

    it('startPropertyDiscovery calls funnel analysis when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      startPropertyDiscovery('user-123')

      expect(mockFunnelAnalysis.startFunnel).toHaveBeenCalledWith('property_discovery', 'user-123')
    })

    it('startRentalApplication respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      startRentalApplication('user-123')

      expect(mockFunnelAnalysis.startFunnel).not.toHaveBeenCalled()
    })

    it('startRentalApplication calls funnel analysis when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      startRentalApplication('user-123')

      expect(mockFunnelAnalysis.startFunnel).toHaveBeenCalledWith('rental_application', 'user-123')
    })

    it('startPaymentSetup respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      startPaymentSetup('user-123')

      expect(mockFunnelAnalysis.startFunnel).not.toHaveBeenCalled()
    })

    it('startPaymentSetup calls funnel analysis when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      startPaymentSetup('user-123')

      expect(mockFunnelAnalysis.startFunnel).toHaveBeenCalledWith('payment_setup', 'user-123')
    })

    it('startStakingInvestment respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      startStakingInvestment('user-123')

      expect(mockFunnelAnalysis.startFunnel).not.toHaveBeenCalled()
    })

    it('startStakingInvestment calls funnel analysis when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      startStakingInvestment('user-123')

      expect(mockFunnelAnalysis.startFunnel).toHaveBeenCalledWith('staking_investment', 'user-123')
    })

    it('startWhistleblowerReport respects analytics consent', () => {
      mockConsentManager.hasConsent.mockReturnValue(false)

      startWhistleblowerReport('user-123')

      expect(mockFunnelAnalysis.startFunnel).not.toHaveBeenCalled()
    })

    it('startWhistleblowerReport calls funnel analysis when consent is given', () => {
      mockConsentManager.hasConsent.mockReturnValue(true)

      startWhistleblowerReport('user-123')

      expect(mockFunnelAnalysis.startFunnel).toHaveBeenCalledWith('whistleblower_report', 'user-123')
    })
  })

  describe('consent helpers', () => {
    it('updateConsent calls consentManager.updatePreferences', () => {
      const preferences = { analytics: true, marketing: false }
      updateConsent(preferences)

      expect(mockConsentManager.updatePreferences).toHaveBeenCalledWith(preferences)
    })

    it('getConsentStatus calls consentManager.getPreferences', () => {
      const mockPreferences = { analytics: true, performance: false }
      mockConsentManager.getPreferences.mockReturnValue(mockPreferences)

      const result = getConsentStatus()

      expect(mockConsentManager.getPreferences).toHaveBeenCalled()
      expect(result).toBe(mockPreferences)
    })

    it('exportAnalyticsData exports all data modules', () => {
      mockAnalytics.getEvents.mockReturnValue([{ event: 'test' }])
      mockFunnelAnalysis.getAllFunnelAnalytics.mockReturnValue(new Map([['test', { data: 'test' }]]))
      mockPerformanceTracking.getMetrics.mockReturnValue({ metric: 'value' })
      mockConsentManager.getPreferences.mockReturnValue({ analytics: true })

      const result = exportAnalyticsData()

      const parsed = JSON.parse(result)
      expect(parsed).toHaveProperty('events')
      expect(parsed).toHaveProperty('funnels')
      expect(parsed).toHaveProperty('performance')
      expect(parsed).toHaveProperty('consent')
      expect(parsed).toHaveProperty('timestamp')
    })
  })
})
