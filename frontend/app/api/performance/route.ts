import { NextRequest, NextResponse } from 'next/server'


export async function POST(request: NextRequest) {
  try {
    // Basic rate limit / sampling based on IP or client
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const now = Date.now()
    const lastReq = recentRequests.get(ip) || 0
    if (now - lastReq < 1000) {
      // Rate limit: max 1 request per second per IP
      return NextResponse.json({ success: true, message: 'Rate limited' }, { status: 200 })
    }
    recentRequests.set(ip, now)

    const report: PerformanceReport = await request.json()
    
    // Use structured logging with sanitized / summarized metrics if needed
    // or sample the logs (e.g. only log 20% of reports to avoid log volume explosion)
    if (Math.random() < 0.2) {
      console.info(JSON.stringify({
        event: 'performance_report',
        timestamp: new Date(report.timestamp).toISOString(),
        url: report.url,
        metricCount: Object.keys(report.metrics || {}).length,
      }))
    }
    
    // Here you could:
    // 1. Store metrics in a database
    // 2. Send to analytics service
    // 3. Trigger alerts for poor performance
    
    return NextResponse.json({ 
      success: true, 
      message: 'Performance metrics received' 
    })
  } catch (error) {
    console.error('Error processing performance report:', error)
    return NextResponse.json(
      { error: 'Failed to process performance report' },
      { status: 400 }
    )
  }
}
export interface PerformanceReport {
  metrics: Record<string, number>
  budgetStatus: Record<string, 'pass' | 'warn' | 'fail'>
  timestamp: number
  url: string
}

// Simple in-memory rate limiter with cleanup (TTL / bounded map) to prevent memory leaks
const recentRequests = new Map<string, number>()
const MAX_RECENT_REQUESTS = 10000
const TTL_MS = 60000 // 1 minute TTL

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const now = Date.now()

    // Evict old entries or prune if map gets too large
    if (recentRequests.size > MAX_RECENT_REQUESTS) {
      for (const [key, timestamp] of recentRequests.entries()) {
        if (now - timestamp > TTL_MS) {
          recentRequests.delete(key)
        }
      }
      // If still too large, clear half
      if (recentRequests.size > MAX_RECENT_REQUESTS) {
        let i = 0
        for (const key of recentRequests.keys()) {
          recentRequests.delete(key)
          if (i++ > MAX_RECENT_REQUESTS / 2) break
        }
      }
    }

    const lastReq = recentRequests.get(ip) || 0
    if (now - lastReq < 1000) {
      return NextResponse.json({ success: false, message: 'Rate limited' }, { status: 429 })
    }
    recentRequests.set(ip, now)

    const report: PerformanceReport = await request.json()
    
    // Use structured logging with sanitized / summarized metrics if needed
    // or sample the logs (e.g. only log 20% of reports to avoid log volume explosion)
    if (Math.random() < 0.2) {
      console.info(JSON.stringify({
        event: 'performance_report',
        timestamp: new Date(report.timestamp).toISOString(),
        url: report.url,
        metricCount: Object.keys(report.metrics || {}).length,
      }))
    }
    
    // Here you could:
    // 1. Store metrics in a database
    // 2. Send to analytics service
    // 3. Trigger alerts for poor performance
    
    return NextResponse.json({ 
      success: true, 
      message: 'Performance metrics received' 
    })
  } catch (error) {
    console.error('Error processing performance report:', error)
    return NextResponse.json(
      { error: 'Failed to process performance report' },
      { status: 400 }
    )
  }
}

export async function GET() {
  return NextResponse.json({ 
    message: 'Performance API endpoint',
    status: 'active'
  })
}
