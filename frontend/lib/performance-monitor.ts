import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals'

export interface PerformanceBudget {
  fcp: number
  lcp: number
  inp: number
  cls: number
  ttfb: number
}

export interface PerformanceReport {
  metrics: Record<string, number>
  budgetStatus: Record<string, 'pass' | 'warn' | 'fail'>
  timestamp: number
  url: string
}

const DEFAULT_BUDGETS: PerformanceBudget = {
  fcp: 1800,
  lcp: 2500,
  inp: 200,
  cls: 0.1,
  ttfb: 800,
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor
  private metrics: Map<string, number> = new Map()
  private budgets: PerformanceBudget = DEFAULT_BUDGETS
  private endpoint: string = '/api/performance'

  private constructor() {
    if (typeof window !== 'undefined') {
      this.initializeTracking()
    }
  }

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor()
    }
    return PerformanceMonitor.instance
  }

  private initializeTracking(): void {
    const handler = (metric: Metric) => {
      this.recordMetric(metric.name, metric.value)
      this.reportIfNeeded()
    }

    onCLS(handler)
    onFCP(handler)
    onINP(handler)
    onLCP(handler)
    onTTFB(handler)
  }

  private recordMetric(name: string, value: number): void {
    this.metrics.set(name, value)
  }

  private reportIfNeeded(): void {
    if (this.metrics.size >= 5) {
      this.sendReport()
    }
  }

  private sendReport(): void {
    const report = this.generateReport()
    
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(this.endpoint, JSON.stringify(report))
    } else {
      fetch(this.endpoint, {
        method: 'POST',
        body: JSON.stringify(report),
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {})
    }
  }

  private generateReport(): PerformanceReport {
    const budgetStatus: Record<string, 'pass' | 'warn' | 'fail'> = {}
    
    this.metrics.forEach((value, name) => {
      const budget = this.budgets[name.toLowerCase() as keyof PerformanceBudget]
      if (budget) {
        if (value <= budget) {
          budgetStatus[name] = 'pass'
        } else if (value <= budget * 1.5) {
          budgetStatus[name] = 'warn'
        } else {
          budgetStatus[name] = 'fail'
        }
      }
    })

    return {
      metrics: Object.fromEntries(this.metrics),
      budgetStatus,
      timestamp: Date.now(),
      url: typeof window !== 'undefined' ? window.location.href : '',
    }
  }

  setBudgets(budgets: Partial<PerformanceBudget>): void {
    this.budgets = { ...this.budgets, ...budgets }
  }

  getMetrics(): Map<string, number> {
    return new Map(this.metrics)
  }
}

export const performanceMonitor = PerformanceMonitor.getInstance()
