import { NextRequest, NextResponse } from 'next/server'

export interface PerformanceReport {
  metrics: Record<string, number>
  budgetStatus: Record<string, 'pass' | 'warn' | 'fail'>
  timestamp: number
  url: string
}

// Simple in-memory rate limiter / sampler (e.g. 10% sampling or rate limit per IP/time)
const recentRequests = new Map<string, number>()

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

export async function GET() {
  return NextResponse.json({ 
    message: 'Performance API endpoint',
    status: 'active'
  })
}
