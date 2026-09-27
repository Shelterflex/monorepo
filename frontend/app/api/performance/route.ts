import { NextRequest, NextResponse } from 'next/server'

export interface PerformanceReport {
  metrics: Record<string, number>
  budgetStatus: Record<string, 'pass' | 'warn' | 'fail'>
  timestamp: number
  url: string
}

// --- Server-side in-memory rate limiter ---

const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60 // max beacons per IP per window
const LOG_SAMPLE_RATE = 0.1 // log 1-in-10 successful reports to reduce volume

interface RateBucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, RateBucket>()

// Periodically evict expired buckets to prevent unbounded memory growth.
// setInterval is safe in Next.js API routes — it runs in the Node.js server process.
const CLEANUP_INTERVAL_MS = 5 * 60_000 // every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) {
      buckets.delete(key)
    }
  }
}, CLEANUP_INTERVAL_MS).unref() // .unref() so it doesn't keep the process alive

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now()
  let bucket = buckets.get(ip)

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    buckets.set(ip, bucket)
  }

  bucket.count++

  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0 }
  }

  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - bucket.count }
}

// --- Helpers ---

/** Strip query string from a URL to avoid logging sensitive params. */
function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return `${u.origin}${u.pathname}`
  } catch {
    // If it isn't a valid URL just return the pathname-like string as-is
    return raw.split('?')[0]
  }
}

// --- Route handlers ---

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  // Rate-limit check
  const { allowed, remaining } = checkRateLimit(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many performance reports — try again later' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)),
        },
      }
    )
  }

  try {
    const report: PerformanceReport = await request.json()

    // Sample logging: only log a fraction of reports to avoid unbounded log volume.
    // Always log reports that contain at least one "fail" budget status.
    const hasBudgetFailure = Object.values(report.budgetStatus ?? {}).some(
      (s) => s === 'fail'
    )
    const shouldLog = hasBudgetFailure || Math.random() < LOG_SAMPLE_RATE

    if (shouldLog) {
      // Structured JSON log — one line, machine-parseable
      const entry = {
        level: hasBudgetFailure ? 'warn' : 'info',
        event: 'performance_report',
        timestamp: new Date(report.timestamp).toISOString(),
        url: sanitizeUrl(report.url),
        metrics: report.metrics,
        budgetStatus: report.budgetStatus,
        sampled: !hasBudgetFailure, // true when included only by sampling
      }
      console.log(JSON.stringify(entry))
    }

    return NextResponse.json(
      { success: true, message: 'Performance metrics received' },
      {
        headers: {
          'X-RateLimit-Remaining': String(remaining),
        },
      }
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'performance_report_error',
        error: error instanceof Error ? error.message : String(error),
      })
    )
    return NextResponse.json(
      { error: 'Failed to process performance report' },
      { status: 400 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Performance API endpoint',
    status: 'active',
  })
}
