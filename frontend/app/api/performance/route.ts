import { NextRequest, NextResponse } from 'next/server'

export interface PerformanceReport {
  metrics: Record<string, number>
  budgetStatus: Record<string, 'pass' | 'warn' | 'fail'>
  timestamp: number
  url: string
}

export async function POST(request: NextRequest) {
  try {
    const report: PerformanceReport = await request.json()
    
    // Log performance metrics for monitoring
    console.log('Performance Report:', {
      timestamp: new Date(report.timestamp).toISOString(),
      url: report.url,
      metrics: report.metrics,
      budgetStatus: report.budgetStatus
    })
    
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
