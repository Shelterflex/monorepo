/**
 * In-process metrics registry.
 *
 * Collects:
 *  - HTTP request counts, latency histograms, and error rates per route
 *  - Business KPIs (payments initiated / completed / failed)
 *  - Alert thresholds for critical failure detection
 *
 * Intentionally dependency-free — exported values can be scraped by
 * Prometheus via the /health/metrics endpoint or forwarded to any
 * OpenTelemetry collector.
 */

// ── Histogram bucket boundaries (ms) ─────────────────────────────────────────
const LATENCY_BUCKETS = [10, 25, 50, 100, 200, 500, 1000, 2500, 5000]

export interface LatencyHistogram {
  buckets: Record<string, number> // "<= Xms": count
  sum: number
  count: number
  p50: number
  p95: number
  p99: number
}

interface RouteMetrics {
  requestCount: number
  errorCount: number
  latency: {
    buckets: number[] // parallel to LATENCY_BUCKETS
    sum: number
    count: number
    samples: number[] // ring buffer (last 1000 samples) for percentiles
  }
}

interface BusinessKPIs {
  paymentsInitiated: number
  paymentsCompleted: number
  paymentsFailed: number
  stakingDeposits: number
}

interface AlertThresholds {
  errorRateWarnPct: number  // default 5
  errorRateErrorPct: number // default 20
  p99LatencyWarnMs: number  // default 2000
  p99LatencyErrorMs: number // default 5000
}

// ── State ─────────────────────────────────────────────────────────────────────

const routes = new Map<string, RouteMetrics>()
const kpis: BusinessKPIs = {
  paymentsInitiated: 0,
  paymentsCompleted: 0,
  paymentsFailed: 0,
  stakingDeposits: 0,
}
const startedAt = Date.now()

const THRESHOLDS: AlertThresholds = {
  errorRateWarnPct: parseFloat(process.env.METRICS_ERROR_WARN_PCT ?? '5'),
  errorRateErrorPct: parseFloat(process.env.METRICS_ERROR_ERROR_PCT ?? '20'),
  p99LatencyWarnMs: parseFloat(process.env.METRICS_P99_WARN_MS ?? '2000'),
  p99LatencyErrorMs: parseFloat(process.env.METRICS_P99_ERROR_MS ?? '5000'),
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function getOrCreate(route: string): RouteMetrics {
  if (!routes.has(route)) {
    routes.set(route, {
      requestCount: 0,
      errorCount: 0,
      latency: { buckets: new Array(LATENCY_BUCKETS.length).fill(0), sum: 0, count: 0, samples: [] },
    })
  }
  return routes.get(route)!
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a completed HTTP request.
 * Call this at the end of a request (e.g. in res.on('finish')).
 */
export function recordRequest(route: string, statusCode: number, durationMs: number): void {
  const m = getOrCreate(route)
  m.requestCount++
  if (statusCode >= 500) m.errorCount++

  m.latency.sum += durationMs
  m.latency.count++

  // Bucket
  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    if (durationMs <= LATENCY_BUCKETS[i]) {
      m.latency.buckets[i]++
      break
    }
  }

  // Ring buffer — keep last 1000 samples for percentile accuracy
  if (m.latency.samples.length >= 1000) m.latency.samples.shift()
  m.latency.samples.push(durationMs)
}

/** Increment a business KPI counter. */
export function recordKPI(key: keyof BusinessKPIs): void {
  kpis[key]++
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface RouteSnapshot {
  route: string
  requestCount: number
  errorCount: number
  errorRatePct: number
  latency: LatencyHistogram
  alertLevel: 'ok' | 'warn' | 'error'
}

export interface MetricsSnapshot {
  uptimeSeconds: number
  collectedAt: string
  routes: RouteSnapshot[]
  kpis: BusinessKPIs
  totalRequests: number
  totalErrors: number
  overallErrorRatePct: number
  overallAlertLevel: 'ok' | 'warn' | 'error'
}

export function getMetricsSnapshot(): MetricsSnapshot {
  const routeSnapshots: RouteSnapshot[] = []
  let totalRequests = 0
  let totalErrors = 0
  let overallAlert: 'ok' | 'warn' | 'error' = 'ok'

  for (const [route, m] of routes) {
    totalRequests += m.requestCount
    totalErrors += m.errorCount

    const sorted = [...m.latency.samples].sort((a, b) => a - b)
    const p50 = percentile(sorted, 50)
    const p95 = percentile(sorted, 95)
    const p99 = percentile(sorted, 99)

    const errorRatePct = m.requestCount > 0 ? (m.errorCount / m.requestCount) * 100 : 0

    const bucketLabels: Record<string, number> = {}
    for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
      bucketLabels[`le_${LATENCY_BUCKETS[i]}ms`] = m.latency.buckets[i]
    }

    let alertLevel: 'ok' | 'warn' | 'error' = 'ok'
    if (errorRatePct >= THRESHOLDS.errorRateErrorPct || p99 >= THRESHOLDS.p99LatencyErrorMs) {
      alertLevel = 'error'
    } else if (errorRatePct >= THRESHOLDS.errorRateWarnPct || p99 >= THRESHOLDS.p99LatencyWarnMs) {
      alertLevel = 'warn'
    }

    if (alertLevel === 'error') overallAlert = 'error'
    else if (alertLevel === 'warn' && overallAlert !== 'error') overallAlert = 'warn'

    routeSnapshots.push({
      route,
      requestCount: m.requestCount,
      errorCount: m.errorCount,
      errorRatePct: Math.round(errorRatePct * 100) / 100,
      latency: {
        buckets: bucketLabels,
        sum: m.latency.sum,
        count: m.latency.count,
        p50,
        p95,
        p99,
      },
      alertLevel,
    })
  }

  const overallErrorRatePct =
    totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 10000) / 100 : 0

  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    collectedAt: new Date().toISOString(),
    routes: routeSnapshots.sort((a, b) => b.requestCount - a.requestCount),
    kpis: { ...kpis },
    totalRequests,
    totalErrors,
    overallErrorRatePct,
    overallAlertLevel: overallAlert,
  }
}

/** Express middleware that records request metrics automatically. */
export function metricsMiddleware(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  const start = Date.now()
  const route = `${req.method} ${req.route?.path ?? req.path}`

  res.on('finish', () => {
    recordRequest(route, res.statusCode, Date.now() - start)
  })

  next()
}
