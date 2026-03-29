import { analytics } from './analytics'
import { funnelAnalysis } from './funnel-analysis'
import { performanceTracking } from './performance-tracking'
import { consentManager } from './consent-manager'

// Initialize analytics system
export function initializeAnalytics(): void {
  // Initialize consent manager first
  consentManager.initialize()
  
  // Check if user has given consent
  if (consentManager.hasConsent('analytics')) {
    analytics.initialize()
  }
  
  if (consentManager.hasConsent('performance')) {
    performanceTracking.startTracking()
  }
  
  // Track initialization
  if (consentManager.hasConsent('analytics')) {
    analytics.track('analytics_initialized', {
      timestamp: Date.now(),
      consent: consentManager.getPreferences(),
      version: '1.0.0'
    })
  }
}

// Track page views
export function trackPageView(path?: string): void {
  if (consentManager.hasConsent('analytics')) {
    analytics.trackPageView(path)
  }
}

// Track user interactions
export function trackUserInteraction(action: string, properties?: Record<string, any>): void {
  if (consentManager.hasConsent('analytics')) {
    analytics.track('user_interaction', {
      action,
      ...properties
    })
  }
}

// Track form submissions
export function trackFormSubmission(formName: string, properties?: Record<string, any>): void {
  if (consentManager.hasConsent('analytics')) {
    analytics.track('form_submission', {
      formName,
      ...properties
    })
  }
}

// Track conversions
export function trackConversion(type: string, value?: number, properties?: Record<string, any>): void {
  if (consentManager.hasConsent('analytics')) {
    analytics.track('conversion', {
      type,
      value,
      ...properties
    })
  }
}

// Track errors
export function trackError(error: Error, context?: Record<string, any>): void {
  if (consentManager.hasConsent('analytics')) {
    analytics.track('error', {
      message: error.message,
      stack: error.stack,
      context
    })
  }
}

// Track feature usage
export function trackFeatureUsage(feature: string, properties?: Record<string, any>): void {
  if (consentManager.hasConsent('analytics')) {
    analytics.track('feature_usage', {
      feature,
      ...properties
    })
  }
}

// Funnel tracking helpers
export function startUserRegistration(userId: string): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.startFunnel('user_registration', userId)
  }
}

export function trackRegistrationStep(userId: string, step: string, properties?: Record<string, any>): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.trackStep('user_registration', userId, step, properties)
  }
}

export function completeUserRegistration(userId: string, properties?: Record<string, any>): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.completeFunnel('user_registration', userId, properties)
  }
}

export function startPropertyDiscovery(userId: string): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.startFunnel('property_discovery', userId)
  }
}

export function trackPropertyDiscoveryStep(userId: string, step: string, properties?: Record<string, any>): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.trackStep('property_discovery', userId, step, properties)
  }
}

export function startRentalApplication(userId: string): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.startFunnel('rental_application', userId)
  }
}

export function trackRentalApplicationStep(userId: string, step: string, properties?: Record<string, any>): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.trackStep('rental_application', userId, step, properties)
  }
}

export function startPaymentSetup(userId: string): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.startFunnel('payment_setup', userId)
  }
}

export function trackPaymentSetupStep(userId: string, step: string, properties?: Record<string, any>): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.trackStep('payment_setup', userId, step, properties)
  }
}

export function startStakingInvestment(userId: string): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.startFunnel('staking_investment', userId)
  }
}

export function trackStakingInvestmentStep(userId: string, step: string, properties?: Record<string, any>): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.trackStep('staking_investment', userId, step, properties)
  }
}

export function startWhistleblowerReport(userId: string): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.startFunnel('whistleblower_report', userId)
  }
}

export function trackWhistleblowerReportStep(userId: string, step: string, properties?: Record<string, any>): void {
  if (consentManager.hasConsent('analytics')) {
    funnelAnalysis.trackStep('whistleblower_report', userId, step, properties)
  }
}

// Performance tracking helpers
export function trackCustomPerformanceMetric(name: string, value: number, unit?: string): void {
  if (consentManager.hasConsent('performance')) {
    performanceTracking.trackCustomMetric(name, value, unit)
  }
}

// Consent helpers
export function updateConsent(preferences: any): void {
  consentManager.updatePreferences(preferences)
}

export function getConsentStatus(): any {
  return consentManager.getPreferences()
}

export function exportAnalyticsData(): string {
  return JSON.stringify({
    events: analytics.getEvents(),
    funnels: Object.fromEntries(funnelAnalysis.getAllFunnelAnalytics()),
    performance: performanceTracking.getMetrics(),
    consent: consentManager.getPreferences(),
    timestamp: Date.now()
  }, null, 2)
}

// React hooks for easy integration
export function useAnalytics() {
  const trackEvent = (event: string, properties?: Record<string, any>) => {
    trackUserInteraction(event, properties)
  }

  const trackPage = (path?: string) => {
    trackPageView(path)
  }

  const trackForm = (formName: string, properties?: Record<string, any>) => {
    trackFormSubmission(formName, properties)
  }

  const trackConversionEvent = (type: string, value?: number, properties?: Record<string, any>) => {
    trackConversion(type, value, properties)
  }

  const trackErrorEvent = (error: Error, context?: Record<string, any>) => {
    trackError(error, context)
  }

  const trackFeature = (feature: string, properties?: Record<string, any>) => {
    trackFeatureUsage(feature, properties)
  }

  return {
    trackEvent,
    trackPage,
    trackForm,
    trackConversionEvent,
    trackErrorEvent,
    trackFeature,
    consent: getConsentStatus(),
    updateConsent
  }
}

export function useFunnelAnalytics(funnelName: string) {
  const start = (userId: string, properties?: Record<string, any>) => {
    if (consentManager.hasConsent('analytics')) {
      funnelAnalysis.startFunnel(funnelName, userId, properties)
    }
  }

  const trackStep = (userId: string, step: string, properties?: Record<string, any>) => {
    if (consentManager.hasConsent('analytics')) {
      funnelAnalysis.trackStep(funnelName, userId, step, properties)
    }
  }

  const complete = (userId: string, properties?: Record<string, any>) => {
    if (consentManager.hasConsent('analytics')) {
      funnelAnalysis.completeFunnel(funnelName, userId, properties)
    }
  }

  const dropOff = (userId: string, reason?: string) => {
    if (consentManager.hasConsent('analytics')) {
      funnelAnalysis.dropOff(funnelName, userId, reason)
    }
  }

  const getAnalytics = () => {
    return funnelAnalysis.getFunnelAnalytics(funnelName)
  }

  const getInsights = () => {
    return funnelAnalysis.getOptimizationInsights(funnelName)
  }

  return {
    start,
    trackStep,
    complete,
    dropOff,
    getAnalytics,
    getInsights
  }
}

export function usePerformanceTracking() {
  const trackMetric = (name: string, value: number, unit?: string) => {
    trackCustomPerformanceMetric(name, value, unit)
  }

  const getMetrics = () => {
    return performanceTracking.getMetrics()
  }

  const getScore = () => {
    return performanceTracking.getPerformanceScore()
  }

  const exportData = () => {
    return performanceTracking.exportMetrics()
  }

  return {
    trackMetric,
    getMetrics,
    getScore,
    exportData
  }
}

// Auto-initialize on module import
if (typeof globalThis !== 'undefined') {
  // Initialize analytics system
  setTimeout(() => {
    initializeAnalytics()
  }, 0)
}
