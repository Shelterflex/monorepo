import { analytics } from './analytics'
import { performanceTracking } from './performance-tracking'

interface ConsentCategory {
  id: string
  name: string
  description: string
  required: boolean
  cookies: string[]
  scripts: string[]
  purposes: string[]
}

interface ConsentPreferences {
  analytics: boolean
  performance: boolean
  functional: boolean
  marketing: boolean
  version: string
  timestamp: number
  acceptedAll?: boolean
  rejectedAll?: boolean
}

interface ConsentBannerConfig {
  title: string
  description: string
  acceptAllText: string
  rejectAllText: string
  customizeText: string
  privacyPolicyUrl: string
  showBanner: boolean
  position: 'top' | 'bottom' | 'center'
  theme: 'light' | 'dark' | 'auto'
}

class ConsentManager {
  private static instance: ConsentManager
  private preferences: ConsentPreferences = {
    analytics: false,
    performance: false,
    functional: false,
    marketing: false,
    version: '1.0',
    timestamp: 0
  }
  private consentCategories: ConsentCategory[] = []
  private isInitialized = false
  private bannerConfig!: ConsentBannerConfig
  private onConsentChangeCallbacks: ((preferences: ConsentPreferences) => void)[] = []

  constructor() {
    this.initializeCategories()
    this.initializeConfig()
    this.loadPreferences()
  }

  static getInstance(): ConsentManager {
    if (!ConsentManager.instance) {
      ConsentManager.instance = new ConsentManager()
    }
    return ConsentManager.instance
  }

  private initializeCategories(): void {
    this.consentCategories = [
      {
        id: 'necessary',
        name: 'Essential Cookies',
        description: 'These cookies are essential for the website to function and cannot be disabled.',
        required: true,
        cookies: ['session', 'csrf_token', 'auth'],
        scripts: [],
        purposes: ['security', 'authentication', 'basic_functionality']
      },
      {
        id: 'analytics',
        name: 'Analytics Cookies',
        description: 'Help us understand how visitors interact with our website by collecting and reporting information anonymously.',
        required: false,
        cookies: ['analytics_session', 'analytics_user_id', 'ga_*'],
        scripts: ['google-analytics', 'vercel-analytics'],
        purposes: ['analytics', 'performance_monitoring', 'user_behavior_analysis']
      },
      {
        id: 'performance',
        name: 'Performance Cookies',
        description: 'These cookies help us improve the performance of our website by monitoring speed and reliability.',
        required: false,
        cookies: ['performance_metrics', 'web_vitals'],
        scripts: ['performance-monitoring'],
        purposes: ['performance_optimization', 'user_experience']
      },
      {
        id: 'functional',
        name: 'Functional Cookies',
        description: 'Enable enhanced functionality and personalization, such as videos and live chats.',
        required: false,
        cookies: ['preferences', 'localization', 'theme'],
        scripts: ['functional-scripts'],
        purposes: ['personalization', 'user_preferences', 'enhanced_features']
      },
      {
        id: 'marketing',
        name: 'Marketing Cookies',
        description: 'Used to deliver advertisements that are relevant to you and your interests.',
        required: false,
        cookies: ['marketing_tracking', 'ad_personalization'],
        scripts: ['marketing-scripts'],
        purposes: ['advertising', 'personalization', 'cross_site_tracking']
      }
    ]
  }

  private initializeConfig(): void {
    this.bannerConfig = {
      title: 'Privacy & Cookie Consent',
      description: 'We use cookies to enhance your experience, analyze site traffic, and personalize content. By accepting, you agree to our use of cookies.',
      acceptAllText: 'Accept All',
      rejectAllText: 'Reject All',
      customizeText: 'Customize',
      privacyPolicyUrl: '/privacy-policy',
      showBanner: true,
      position: 'bottom',
      theme: 'auto'
    }
  }

  private loadPreferences(): void {
    if (typeof globalThis === 'undefined') return

    try {
      const stored = globalThis.localStorage?.getItem('consent_preferences')
      if (stored) {
        this.preferences = JSON.parse(stored)
        this.applyConsent()
      }
    } catch (error) {
      console.warn('Failed to load consent preferences:', error)
    }
  }

  private savePreferences(): void {
    if (typeof globalThis === 'undefined') return

    try {
      this.preferences.timestamp = Date.now()
      globalThis.localStorage?.setItem('consent_preferences', JSON.stringify(this.preferences))
    } catch (error) {
      console.warn('Failed to save consent preferences:', error)
    }
  }

  private applyConsent(): void {
    // Apply analytics consent
    if (this.preferences.analytics) {
      analytics.setConsent({ analytics: true })
      analytics.initialize()
    } else {
      analytics.setConsent({ analytics: false })
    }

    // Apply performance consent
    if (this.preferences.performance) {
      performanceTracking.startTracking()
    } else {
      performanceTracking.stopTracking()
    }

    // Apply functional consent
    if (this.preferences.functional) {
      this.enableFunctionalFeatures()
    } else {
      this.disableFunctionalFeatures()
    }

    // Apply marketing consent
    if (this.preferences.marketing) {
      this.enableMarketingFeatures()
    } else {
      this.disableMarketingFeatures()
    }

    // Notify callbacks
    this.onConsentChangeCallbacks.forEach(callback => {
      try {
        callback(this.preferences)
      } catch (error) {
        console.warn('Consent change callback failed:', error)
      }
    })

    // Track consent event
    if (this.preferences.analytics) {
      analytics.track('consent_updated', {
        categories: this.preferences,
        timestamp: this.preferences.timestamp
      })
    }
  }

  private enableFunctionalFeatures(): void {
    // Enable features like theme preferences, language settings, etc.
    if (typeof globalThis !== 'undefined') {
      // Enable theme persistence
      const theme = globalThis.localStorage?.getItem('theme')
      if (theme) {
        globalThis.document.documentElement.setAttribute('data-theme', theme)
      }
    }
  }

  private disableFunctionalFeatures(): void {
    // Disable functional features
    if (typeof globalThis !== 'undefined') {
      globalThis.document.documentElement.removeAttribute('data-theme')
    }
  }

  private enableMarketingFeatures(): void {
    // Enable marketing features like personalization, A/B testing, etc.
    // This would typically involve loading marketing scripts
  }

  private disableMarketingFeatures(): void {
    // Disable marketing features
    // Remove marketing cookies and scripts
  }

  // Public API
  consentAll(): void {
    this.preferences = {
      analytics: true,
      performance: true,
      functional: true,
      marketing: true,
      version: '1.0',
      timestamp: Date.now(),
      acceptedAll: true,
      rejectedAll: false
    }
    
    this.savePreferences()
    this.applyConsent()
    this.hideBanner()
  }

  rejectAll(): void {
    this.preferences = {
      analytics: false,
      performance: false,
      functional: false,
      marketing: false,
      version: '1.0',
      timestamp: Date.now(),
      acceptedAll: false,
      rejectedAll: true
    }
    
    this.savePreferences()
    this.applyConsent()
    this.hideBanner()
  }

  updatePreferences(preferences: Partial<ConsentPreferences>): void {
    this.preferences = {
      ...this.preferences,
      ...preferences,
      version: '1.0',
      timestamp: Date.now(),
      acceptedAll: undefined,
      rejectedAll: undefined
    }
    
    this.savePreferences()
    this.applyConsent()
  }

  getPreferences(): ConsentPreferences {
    return { ...this.preferences }
  }

  hasConsent(category: keyof Omit<ConsentPreferences, 'version' | 'timestamp' | 'acceptedAll' | 'rejectedAll'>): boolean {
    return Boolean(this.preferences[category])
  }

  getCategories(): ConsentCategory[] {
    return [...this.consentCategories]
  }

  getCategory(id: string): ConsentCategory | undefined {
    return this.consentCategories.find(cat => cat.id === id)
  }

  // Banner management
  shouldShowBanner(): boolean {
    return this.bannerConfig.showBanner && !this.hasGivenConsent()
  }

  hasGivenConsent(): boolean {
    return this.preferences.timestamp > 0
  }

  showBanner(): void {
    this.bannerConfig.showBanner = true
  }

  hideBanner(): void {
    this.bannerConfig.showBanner = false
  }

  getBannerConfig(): ConsentBannerConfig {
    return { ...this.bannerConfig }
  }

  updateBannerConfig(config: Partial<ConsentBannerConfig>): void {
    this.bannerConfig = { ...this.bannerConfig, ...config }
  }

  // Cookie management
  getCookieInfo(): {
    total: number
    byCategory: Record<string, string[]>
    activeCookies: string[]
  } {
    const byCategory: Record<string, string[]> = {}
    const activeCookies: string[] = []

    this.consentCategories.forEach(category => {
      if (category.required || this.hasConsent(category.id as 'analytics' | 'performance' | 'functional' | 'marketing')) {
        byCategory[category.id] = category.cookies
        activeCookies.push(...category.cookies)
      } else {
        byCategory[category.id] = []
      }
    })

    return {
      total: activeCookies.length,
      byCategory,
      activeCookies
    }
  }

  // Data export and deletion
  exportUserData(): {
    consent: ConsentPreferences
    analytics: any[]
    performance: any
    timestamp: number
  } {
    return {
      consent: this.preferences,
      analytics: analytics.getEvents(),
      performance: performanceTracking.getMetrics(),
      timestamp: Date.now()
    }
  }

  deleteUserData(): void {
    // Reset all preferences
    this.preferences = {
      analytics: false,
      performance: false,
      functional: false,
      marketing: false,
      version: '1.0',
      timestamp: 0
    }

    // Clear analytics data
    analytics.reset()

    // Clear performance data
    performanceTracking.reset()

    // Clear localStorage
    if (typeof globalThis !== 'undefined') {
      globalThis.localStorage?.removeItem('consent_preferences')
      globalThis.localStorage?.removeItem('analytics_user_id')
      globalThis.localStorage?.removeItem('analytics_consent')
    }

    // Apply changes
    this.applyConsent()
  }

  // Callback management
  onConsentChange(callback: (preferences: ConsentPreferences) => void): () => void {
    this.onConsentChangeCallbacks.push(callback)
    
    // Return unsubscribe function
    return () => {
      const index = this.onConsentChangeCallbacks.indexOf(callback)
      if (index > -1) {
        this.onConsentChangeCallbacks.splice(index, 1)
      }
    }
  }

  // Compliance helpers
  isGDPRApplicable(): boolean {
    if (typeof globalThis === 'undefined') return false
    
    // Check if user is in GDPR region
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const gdprTimezones = [
      'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
      'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Vienna',
      'Europe/Dublin', 'Europe/Stockholm', 'Europe/Helsinki', 'Europe/Oslo',
      'Europe/Copenhagen', 'Europe/Warsaw', 'Europe/Prague', 'Europe/Budapest'
    ]
    
    return gdprTimezones.includes(timezone)
  }

  isCCPAApplicable(): boolean {
    if (typeof globalThis === 'undefined') return false
    
    // Check if user is in California (simplified check)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return timezone === 'America/Los_Angeles' || timezone === 'America/Denver'
  }

  getPrivacyRights(): {
    rights: string[]
    description: string
    contactInfo: string
  } {
    const rights = [
      'Right to Know',
      'Right to Delete',
      'Right to Opt-Out',
      'Right to Correct',
      'Right to Portability'
    ]

    const description = this.isGDPRApplicable()
      ? 'Under GDPR, you have the right to access, rectify, erase, or restrict the processing of your personal data.'
      : 'Under CCPA, you have the right to know what personal information is collected and to request deletion.'

    const contactInfo = 'privacy@shelterflex.com'

    return { rights, description, contactInfo }
  }

  // Initialize consent manager
  initialize(): void {
    if (this.isInitialized) return

    this.isInitialized = true
    
    // Show banner if no consent given
    if (this.shouldShowBanner()) {
      // This would typically render the consent banner
      this.showBanner()
    }

    // Apply existing consent
    if (this.hasGivenConsent()) {
      this.applyConsent()
    }
  }

  // Reset
  reset(): void {
    this.preferences = {
      analytics: false,
      performance: false,
      functional: false,
      marketing: false,
      version: '1.0',
      timestamp: 0
    }
    
    this.savePreferences()
    this.applyConsent()
    this.showBanner()
  }
}

export const consentManager = ConsentManager.getInstance()
export default ConsentManager
