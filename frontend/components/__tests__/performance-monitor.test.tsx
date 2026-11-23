import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { PerformanceMonitor } from '../PerformanceMonitor'
import { performanceMonitor } from '@/lib/performance-monitor'

vi.mock('@/lib/performance-monitor', () => ({
  performanceMonitor: {
    setBudgets: vi.fn(),
    getMetrics: vi.fn(() => new Map()),
  },
}))

describe('PerformanceMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('renders nothing and sets the web performance budgets', () => {
    const { container } = render(<PerformanceMonitor />)

    expect(container).toBeEmptyDOMElement()
    expect(performanceMonitor.setBudgets).toHaveBeenCalledWith({
      fcp: 1800,
      lcp: 2500,
      inp: 200,
      cls: 0.1,
      ttfb: 800,
    })
  })

  it('logs collected metrics every 10 seconds in development', () => {
    vi.useFakeTimers()
    vi.stubEnv('NODE_ENV', 'development')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(performanceMonitor.getMetrics).mockReturnValue(new Map([['lcp', 1200]]))

    render(<PerformanceMonitor />)
    vi.advanceTimersByTime(10000)

    expect(log).toHaveBeenCalledWith('[Performance]', { lcp: 1200 })
    log.mockRestore()
  })

  it('does not log when there are no metrics yet', () => {
    vi.useFakeTimers()
    vi.stubEnv('NODE_ENV', 'development')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    render(<PerformanceMonitor />)
    vi.advanceTimersByTime(10000)

    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})
