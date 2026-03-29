// Privacy-focused analytics system
interface AnalyticsEvent {
  event: string
  properties?: Record<string, any>
  timestamp: number
  sessionId: string
  userId?: string
  page?: string
  referrer?: string
  userAgent?: string
}

interface FunnelStep {
  name: string
  step: number
  properties?: Record<string, any>
}

interface PerformanceMetrics {
  fcp?: number // First Contentful Paint
  lcp?: number // Largest Contentful Paint
  fid?: number // First Input Delay
  cls?: number // Cumulative Layout Shift
  ttfb?: number // Time to First Byte
  loadTime?: number
}

interface ConsentSettings {
  analytics: boolean
  performance: boolean
  functional: boolean
  marketing: boolean
}

class Analytics {
  private static instance: Analytics
  private events: AnalyticsEvent[] = []
  private sessionId: string
  private userId: string | null = null
  private consent: ConsentSettings = {
    analytics: false,
    performance: false,
    functional: false,
    marketing: false
  }
  private funnelSteps: Map<string, FunnelStep[]> = new Map()
  private isInitialized = false

  constructor() {
    this.sessionId = this.generateSessionId()
    this.loadConsent()
    this.loadUserId()
  }

  static getInstance(): Analytics {
    if (!Analytics.instance) {
      Analytics.instance = new Analytics()
    }
    return Analytics.instance
  }

  private generateSessionId(): string {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2)
  }

  private generateUserId(): string {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2)
  }

  private loadConsent(): void {
    if (typeof globalThis === 'undefined') return
    
    try {
      const stored = globalThis.localStorage?.getItem('analytics_consent')
      if (stored) {
        this.consent = JSON.parse(stored)
      }
    } catch (error) {
      console.warn('Failed to load consent settings:', error)
    }
  }

  private loadUserId(): void {
    if (typeof globalThis === 'undefined') return
    
    try {
      const stored = globalThis.localStorage?.getItem('analytics_user_id')
      if (stored) {
        this.userId = stored
      }
    } catch (error) {
      console.warn('Failed to load user ID:', error)
    }
  }

  private saveConsent(): void {
    if (typeof globalThis === 'undefined') return
    
    try {
      globalThis.localStorage?.setItem('analytics_consent', JSON.stringify(this.consent))
    } catch (error) {
      console.warn('Failed to save consent settings:', error)
    }
  }

  private saveUserId(): void {
    if (typeof globalThis === 'undefined' || !this.userId) return
    
    try {
      globalThis.localStorage?.setItem('analytics_user_id', this.userId)
    } catch (error) {
      console.warn('Failed to save user ID:', error)
    }
  }

  // Consent Management
  setConsent(consent: Partial<ConsentSettings>): void {
    this.consent = { ...this.consent, ...consent }
    this.saveConsent()
    
    if (this.consent.analytics && !this.isInitialized) {
      this.initialize()
    }
  }

  getConsent(): ConsentSettings {
    return { ...this.consent }
  }

  hasConsent(category: keyof ConsentSettings): boolean {
    return this.consent[category]
  }

  // Initialization
  initialize(): void {
    if (this.isInitialized || !this.consent.analytics) return
    
    this.isInitialized = true
    this.trackPageView()
    this.trackPerformanceMetrics()
    
    // Track session start
    this.track('session_start', {
      sessionId: this.sessionId,
      timestamp: Date.now()
    })
  }

  // User Management
  identify(userId: string, traits?: Record<string, any>): void {
    if (!this.consent.analytics) return
    
    this.userId = userId
    this.saveUserId()
    
    this.track('user_identified', {
      userId,
      traits: this.sanitizeData(traits)
    })
  }

  // Event Tracking
  track(event: string, properties?: Record<string, any>): void {
    if (!this.consent.analytics || !this.isInitialized) return
    
    const analyticsEvent: AnalyticsEvent = {
      event: this.sanitizeEventName(event),
      properties: this.sanitizeData(properties),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      userId: this.userId || undefined,
      page: typeof globalThis !== 'undefined' ? globalThis.location?.pathname : undefined,
      referrer: typeof globalThis !== 'undefined' ? globalThis.document?.referrer : undefined,
      userAgent: typeof globalThis !== 'undefined' ? globalThis.navigator?.userAgent : undefined
    }

    this.events.push(analyticsEvent)
    this.sendEvent(analyticsEvent)
  }

  // Page Tracking
  trackPageView(path?: string): void {
    if (!this.consent.analytics) return
    
    const page = path || (typeof globalThis !== 'undefined' ? globalThis.location?.pathname : '/')
    
    this.track('page_view', {
      page,
      title: typeof globalThis !== 'undefined' ? globalThis.document?.title : '',
      referrer: typeof globalThis !== 'undefined' ? globalThis.document?.referrer : ''
    })
  }

  // Funnel Tracking
  startFunnel(funnelName: string, firstStep: string, properties?: Record<string, any>): void {
    if (!this.consent.analytics) return
    
    const steps: FunnelStep[] = [{
      name: firstStep,
      step: 1,
      properties: this.sanitizeData(properties)
    }]
    
    this.funnelSteps.set(funnelName, steps)
    
    this.track('funnel_start', {
      funnel: funnelName,
      step: firstStep,
      stepNumber: 1,
      ...properties
    })
  }

  trackFunnelStep(funnelName: string, stepName: string, properties?: Record<string, any>): void {
    if (!this.consent.analytics) return
    
    const steps = this.funnelSteps.get(funnelName)
    if (!steps) {
      console.warn(`Funnel "${funnelName}" not started`)
      return
    }
    
    const stepNumber = steps.length + 1
    const step: FunnelStep = {
      name: stepName,
      step: stepNumber,
      properties: this.sanitizeData(properties)
    }
    
    steps.push(step)
    
    this.track('funnel_step', {
      funnel: funnelName,
      step: stepName,
      stepNumber,
      totalSteps: steps.length,
      ...properties
    })
  }

  completeFunnel(funnelName: string, properties?: Record<string, any>): void {
    if (!this.consent.analytics) return
    
    const steps = this.funnelSteps.get(funnelName)
    if (!steps) {
      console.warn(`Funnel "${funnelName}" not started`)
      return
    }
    
    this.track('funnel_complete', {
      funnel: funnelName,
      totalSteps: steps.length,
      completionTime: Date.now() - (steps[0]?.properties?.timestamp || Date.now()),
      ...properties
    })
    
    this.funnelSteps.delete(funnelName)
  }

  getFunnelData(funnelName: string): FunnelStep[] | null {
    return this.funnelSteps.get(funnelName) || null
  }

  // Performance Tracking
  private trackPerformanceMetrics(): void {
    if (!this.consent.performance || typeof globalThis === 'undefined') return
    
    // Track Core Web Vitals
    if ('PerformanceObserver' in globalThis) {
      try {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            switch (entry.entryType) {
              case 'navigation':
                const navEntry = entry as PerformanceNavigationTiming
                this.track('performance_navigation', {
                  fcp: navEntry.loadEventEnd - navEntry.loadEventStart,
                  ttfb: navEntry.responseStart - navEntry.requestStart,
                  domLoad: navEntry.domContentLoadedEventEnd - navEntry.domContentLoadedEventStart,
                  loadTime: navEntry.loadEventEnd - navEntry.fetchStart
                })
                break
              
              case 'paint':
                const paintEntry = entry as PerformanceEntry
                this.track('performance_paint', {
                  name: paintEntry.name,
                  value: paintEntry.startTime
                })
                break
              
              case 'largest-contentful-paint':
                const lcpEntry = entry as any
                this.track('performance_lcp', {
                  value: lcpEntry.startTime
                })
                break
              
              case 'first-input':
                const fidEntry = entry as any
                this.track('performance_fid', {
                  value: fidEntry.processingStart - fidEntry.startTime
                })
                break
              
              case 'layout-shift':
                const clsEntry = entry as any
                if (!clsEntry.hadRecentInput) {
                  this.track('performance_cls', {
                    value: clsEntry.value
                  })
                }
                break
            }
          })
        })
        
        observer.observe({ entryTypes: ['navigation', 'paint', 'largest-contentful-paint', 'first-input', 'layout-shift'] })
      } catch (error) {
        console.warn('Performance observer setup failed:', error)
      }
    }
  }

  // Data Sanitization
  private sanitizeEventName(event: string): string {
    return event.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
  }

  private sanitizeData(data?: Record<string, any>): Record<string, any> | undefined {
    if (!data) return undefined
    
    const sanitized: Record<string, any> = {}
    
    Object.keys(data).forEach(key => {
      const value = data[key]
      
      // Remove PII and sensitive data
      if (typeof key === 'string' && (
        key.toLowerCase().includes('password') ||
        key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('key') ||
        key.toLowerCase().includes('ssn') ||
        key.toLowerCase().includes('credit') ||
        key.toLowerCase().includes('card')
      )) {
        return // Skip sensitive fields
      }
      
      // Sanitize string values
      if (typeof value === 'string') {
        sanitized[key] = value.replace(/[<>]/g, '').substring(0, 500)
      } else if (typeof value === 'number' && isFinite(value)) {
        sanitized[key] = value
      } else if (typeof value === 'boolean') {
        sanitized[key] = value
      } else if (Array.isArray(value)) {
        sanitized[key] = value.slice(0, 10) // Limit array size
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = Object.keys(value).slice(0, 10) // Limit object size
      }
    })
    
    return sanitized
  }

  // Event Transmission
  private async sendEvent(event: AnalyticsEvent): Promise<void> {
    try {
      // Send to Vercel Analytics if available
      if (typeof globalThis !== 'undefined' && 'va' in globalThis) {
        // @ts-ignore - Vercel Analytics global
        globalThis.va('track', event.event, event.properties)
      }
      
      // Also send to custom endpoint if configured
      await this.sendToCustomEndpoint(event)
    } catch (error) {
      console.warn('Failed to send analytics event:', error)
    }
  }

  private async sendToCustomEndpoint(event: AnalyticsEvent): Promise<void> {
    // This would send to your custom analytics backend
    // For now, we'll just store events locally
    if (this.events.length > 1000) {
      this.events = this.events.slice(-500) // Keep only last 500 events
    }
  }

  // Data Retrieval
  getEvents(eventType?: string): AnalyticsEvent[] {
    if (!this.consent.analytics) return []
    
    return eventType 
      ? this.events.filter(e => e.event === eventType)
      : [...this.events]
  }

  getFunnelAnalytics(funnelName: string): {
    totalSteps: number
    completedSteps: number
    conversionRate: number
    steps: FunnelStep[]
  } | null {
    const steps = this.funnelSteps.get(funnelName)
    if (!steps) return null
    
    return {
      totalSteps: steps.length,
      completedSteps: steps.filter(s => s.properties?.completed).length,
      conversionRate: steps.filter(s => s.properties?.completed).length / steps.length,
      steps
    }
  }

  // Reset
  reset(): void {
    this.events = []
    this.funnelSteps.clear()
    this.userId = null
    this.sessionId = this.generateSessionId()
    this.isInitialized = false
    
    if (typeof globalThis !== 'undefined') {
      globalThis.localStorage?.removeItem('analytics_user_id')
    }
  }
}

export const analytics = Analytics.getInstance()
export default Analytics
