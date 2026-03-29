import { analytics } from './analytics'

interface PerformanceMetrics {
  // Core Web Vitals
  fcp?: number // First Contentful Paint
  lcp?: number // Largest Contentful Paint
  fid?: number // First Input Delay
  cls?: number // Cumulative Layout Shift
  ttfb?: number // Time to First Byte
  
  // Navigation Metrics
  domContentLoaded?: number
  loadComplete?: number
  totalLoadTime?: number
  
  // Resource Metrics
  resourceCount?: number
  totalResourceSize?: number
  slowResources?: ResourceMetric[]
  
  // User Experience Metrics
  firstInteraction?: number
  meaningfulInteraction?: number
  visuallyComplete?: number
  
  // Custom Metrics
  customMetrics?: Record<string, number>
}

interface ResourceMetric {
  name: string
  type: string
  size: number
  duration: number
  startTime: number
}

interface PerformanceThreshold {
  metric: keyof PerformanceMetrics
  warning: number
  critical: number
  unit: string
}

class PerformanceTracking {
  private static instance: PerformanceTracking
  private metrics: PerformanceMetrics = {}
  private thresholds: PerformanceThreshold[] = [
    { metric: 'fcp', warning: 1800, critical: 3000, unit: 'ms' },
    { metric: 'lcp', warning: 2500, critical: 4000, unit: 'ms' },
    { metric: 'fid', warning: 100, critical: 300, unit: 'ms' },
    { metric: 'cls', warning: 0.1, critical: 0.25, unit: 'score' },
    { metric: 'ttfb', warning: 800, critical: 1800, unit: 'ms' },
    { metric: 'totalLoadTime', warning: 3000, critical: 5000, unit: 'ms' }
  ]
  private isTracking = false
  private observers: PerformanceObserver[] = []

  constructor() {
    this.initializeThresholds()
  }

  static getInstance(): PerformanceTracking {
    if (!PerformanceTracking.instance) {
      PerformanceTracking.instance = new PerformanceTracking()
    }
    return PerformanceTracking.instance
  }

  private initializeThresholds(): void {
    // Custom thresholds based on industry standards
    this.thresholds = [
      { metric: 'fcp', warning: 1800, critical: 3000, unit: 'ms' },
      { metric: 'lcp', warning: 2500, critical: 4000, unit: 'ms' },
      { metric: 'fid', warning: 100, critical: 300, unit: 'ms' },
      { metric: 'cls', warning: 0.1, critical: 0.25, unit: 'score' },
      { metric: 'ttfb', warning: 800, critical: 1800, unit: 'ms' },
      { metric: 'totalLoadTime', warning: 3000, critical: 5000, unit: 'ms' },
      { metric: 'domContentLoaded', warning: 2000, critical: 4000, unit: 'ms' },
      { metric: 'loadComplete', warning: 4000, critical: 7000, unit: 'ms' }
    ]
  }

  // Start performance tracking
  startTracking(): void {
    if (this.isTracking || typeof globalThis === 'undefined') return
    
    this.isTracking = true
    this.trackCoreWebVitals()
    this.trackNavigationTiming()
    this.trackResourceTiming()
    this.trackUserInteractions()
    
    // Track page load performance
    this.trackPageLoad()
  }

  // Stop performance tracking
  stopTracking(): void {
    this.isTracking = false
    this.observers.forEach(observer => observer.disconnect())
    this.observers = []
  }

  // Core Web Vitals tracking
  private trackCoreWebVitals(): void {
    if (!('PerformanceObserver' in globalThis)) return

    try {
      // Largest Contentful Paint
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const lastEntry = entries[entries.length - 1] as any
        this.metrics.lcp = lastEntry.startTime
        
        analytics.track('performance_lcp', {
          value: lastEntry.startTime,
          rating: this.getRating('lcp', lastEntry.startTime)
        })
      })
      lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] })
      this.observers.push(lcpObserver)

      // First Input Delay
      const fidObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        entries.forEach((entry: any) => {
          this.metrics.fid = entry.processingStart - entry.startTime
          
          analytics.track('performance_fid', {
            value: this.metrics.fid,
            rating: this.getRating('fid', this.metrics.fid)
          })
        })
      })
      fidObserver.observe({ entryTypes: ['first-input'] })
      this.observers.push(fidObserver)

      // Cumulative Layout Shift
      let clsValue = 0
      const clsObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry: any) => {
          if (!entry.hadRecentInput) {
            clsValue += entry.value
            this.metrics.cls = clsValue
            
            analytics.track('performance_cls', {
              value: clsValue,
              rating: this.getRating('cls', clsValue)
            })
          }
        })
      })
      clsObserver.observe({ entryTypes: ['layout-shift'] })
      this.observers.push(clsObserver)

      // First Contentful Paint
      const paintObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (entry.name === 'first-contentful-paint') {
            this.metrics.fcp = entry.startTime
            
            analytics.track('performance_fcp', {
              value: entry.startTime,
              rating: this.getRating('fcp', entry.startTime)
            })
          }
        })
      })
      paintObserver.observe({ entryTypes: ['paint'] })
      this.observers.push(paintObserver)

    } catch (error) {
      console.warn('Failed to setup Core Web Vitals tracking:', error)
    }
  }

  // Navigation timing
  private trackNavigationTiming(): void {
    if (!('PerformanceObserver' in globalThis)) return

    try {
      const navObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (entry.entryType === 'navigation') {
            const navEntry = entry as PerformanceNavigationTiming
            
            this.metrics.ttfb = navEntry.responseStart - navEntry.requestStart
            this.metrics.domContentLoaded = navEntry.domContentLoadedEventEnd - navEntry.fetchStart
            this.metrics.loadComplete = navEntry.loadEventEnd - navEntry.fetchStart
            this.metrics.totalLoadTime = navEntry.loadEventEnd - navEntry.fetchStart
            
            analytics.track('performance_navigation', {
              ttfb: this.metrics.ttfb,
              domContentLoaded: this.metrics.domContentLoaded,
              loadComplete: this.metrics.loadComplete,
              totalLoadTime: this.metrics.totalLoadTime,
              ratings: {
                ttfb: this.getRating('ttfb', this.metrics.ttfb),
                domContentLoaded: this.getRating('domContentLoaded', this.metrics.domContentLoaded),
                totalLoadTime: this.getRating('totalLoadTime', this.metrics.totalLoadTime)
              }
            })
          }
        })
      })
      navObserver.observe({ entryTypes: ['navigation'] })
      this.observers.push(navObserver)
    } catch (error) {
      console.warn('Failed to setup navigation timing tracking:', error)
    }
  }

  // Resource timing
  private trackResourceTiming(): void {
    if (!('PerformanceObserver' in globalThis)) return

    try {
      const resourceObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (entry.entryType === 'resource') {
            const resourceEntry = entry as PerformanceResourceTiming
            const resourceMetric: ResourceMetric = {
              name: resourceEntry.name,
              type: this.getResourceType(resourceEntry.name),
              size: resourceEntry.transferSize || 0,
              duration: resourceEntry.duration,
              startTime: resourceEntry.startTime
            }

            // Track slow resources
            if (resourceMetric.duration > 1000) { // 1 second threshold
              if (!this.metrics.slowResources) {
                this.metrics.slowResources = []
              }
              this.metrics.slowResources.push(resourceMetric)
              
              analytics.track('performance_slow_resource', {
                name: resourceMetric.name,
                type: resourceMetric.type,
                duration: resourceMetric.duration,
                size: resourceMetric.size
              })
            }

            // Update resource metrics
            this.metrics.resourceCount = (this.metrics.resourceCount || 0) + 1
            this.metrics.totalResourceSize = (this.metrics.totalResourceSize || 0) + resourceMetric.size
          }
        })
      })
      resourceObserver.observe({ entryTypes: ['resource'] })
      this.observers.push(resourceObserver)
    } catch (error) {
      console.warn('Failed to setup resource timing tracking:', error)
    }
  }

  // User interaction tracking
  private trackUserInteractions(): void {
    if (typeof globalThis === 'undefined') return

    let firstInteractionTime: number | null = null

    const trackInteraction = (event: Event) => {
      if (!firstInteractionTime) {
        firstInteractionTime = event.timeStamp
        this.metrics.firstInteraction = firstInteractionTime
        
        analytics.track('performance_first_interaction', {
          value: firstInteractionTime,
          rating: this.getRating('firstInteraction', firstInteractionTime)
        })
      }
    }

    // Track various user interactions
    const events = ['click', 'scroll', 'keydown', 'touchstart']
    events.forEach(eventType => {
      globalThis.addEventListener(eventType, trackInteraction, { once: true, passive: true })
    })
  }

  // Page load tracking
  private trackPageLoad(): void {
    if (typeof globalThis === 'undefined') return

    const trackLoad = () => {
      if (globalThis.performance && globalThis.performance.timing) {
        const timing = globalThis.performance.timing
        const loadTime = timing.loadEventEnd - timing.navigationStart
        
        this.metrics.totalLoadTime = loadTime
        
        analytics.track('page_load_complete', {
          loadTime,
          rating: this.getRating('totalLoadTime', loadTime),
          url: globalThis.location?.href,
          userAgent: globalThis.navigator?.userAgent
        })
      }
    }

    if (globalThis.document.readyState === 'complete') {
      trackLoad()
    } else {
      globalThis.addEventListener('load', trackLoad)
    }
  }

  // Custom metric tracking
  trackCustomMetric(name: string, value: number, unit?: string): void {
    if (!this.metrics.customMetrics) {
      this.metrics.customMetrics = {}
    }
    
    this.metrics.customMetrics[name] = value
    
    analytics.track('performance_custom_metric', {
      name,
      value,
      unit: unit || 'ms',
      rating: this.getCustomRating(name, value)
    })
  }

  // Performance rating
  private getRating(metric: keyof PerformanceMetrics, value: number): string {
    const threshold = this.thresholds.find(t => t.metric === metric)
    if (!threshold) return 'unknown'
    
    if (value <= threshold.warning) return 'good'
    if (value <= threshold.critical) return 'needs-improvement'
    return 'poor'
  }

  private getCustomRating(metricName: string, value: number): string {
    // Default rating logic for custom metrics
    return value <= 1000 ? 'good' : value <= 3000 ? 'needs-improvement' : 'poor'
  }

  // Helper methods
  private getResourceType(url: string): string {
    if (url.includes('.js')) return 'script'
    if (url.includes('.css')) return 'stylesheet'
    if (url.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)) return 'image'
    if (url.match(/\.(woff|woff2|ttf|eot)$/i)) return 'font'
    if (url.includes('/api/')) return 'api'
    return 'other'
  }

  // Get current metrics
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics }
  }

  // Get performance score
  getPerformanceScore(): {
    overall: number
    categories: {
      coreWebVitals: number
      loading: number
      interactivity: number
      resources: number
    }
    recommendations: string[]
  } {
    const scores = {
      coreWebVitals: this.calculateCategoryScore(['fcp', 'lcp', 'fid', 'cls']),
      loading: this.calculateCategoryScore(['ttfb', 'domContentLoaded', 'totalLoadTime']),
      interactivity: this.calculateCategoryScore(['firstInteraction', 'meaningfulInteraction']),
      resources: this.calculateResourcesScore()
    }

    const overall = Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.keys(scores).length

    return {
      overall,
      categories: scores,
      recommendations: this.getRecommendations()
    }
  }

  private calculateCategoryScore(metrics: (keyof PerformanceMetrics)[]): number {
    const validMetrics = metrics.filter(metric => {
      const value = this.metrics[metric]
      return value !== undefined && typeof value === 'number'
    })
    if (validMetrics.length === 0) return 100

    const scores = validMetrics.map(metric => {
      const value = this.metrics[metric]! as number
      const rating = this.getRating(metric, value)
      
      switch (rating) {
        case 'good': return 100
        case 'needs-improvement': return 60
        case 'poor': return 20
        default: return 50
      }
    })

    return scores.reduce((sum, score) => sum + score, 0) / scores.length
  }

  private calculateResourcesScore(): number {
    if (!this.metrics.slowResources || this.metrics.slowResources.length === 0) return 100
    
    const slowResourceRatio = this.metrics.slowResources.length / (this.metrics.resourceCount || 1)
    
    if (slowResourceRatio <= 0.1) return 100
    if (slowResourceRatio <= 0.3) return 70
    return 40
  }

  private getRecommendations(): string[] {
    const recommendations: string[] = []

    this.thresholds.forEach(threshold => {
      const value = this.metrics[threshold.metric]
      if (value !== undefined && typeof value === 'number') {
        const rating = this.getRating(threshold.metric, value)
        if (rating === 'poor') {
          recommendations.push(`Optimize ${threshold.metric} (${value}${threshold.unit} exceeds ${threshold.critical}${threshold.unit})`)
        } else if (rating === 'needs-improvement') {
          recommendations.push(`Consider improving ${threshold.metric} (${value}${threshold.unit} is above ${threshold.warning}${threshold.unit})`)
        }
      }
    })

    if (this.metrics.slowResources && this.metrics.slowResources.length > 0) {
      recommendations.push(`${this.metrics.slowResources.length} slow resources detected - consider optimizing or lazy loading`)
    }

    if (this.metrics.totalResourceSize && this.metrics.totalResourceSize > 3000000) { // 3MB
      recommendations.push('Large total resource size - consider compressing assets')
    }

    return recommendations
  }

  // Reset metrics
  reset(): void {
    this.metrics = {}
    this.stopTracking()
  }

  // Export metrics
  exportMetrics(): string {
    return JSON.stringify({
      metrics: this.metrics,
      score: this.getPerformanceScore(),
      timestamp: Date.now(),
      url: typeof globalThis !== 'undefined' ? globalThis.location?.href : undefined
    }, null, 2)
  }
}

export const performanceTracking = PerformanceTracking.getInstance()
export default PerformanceTracking
