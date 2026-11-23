import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { AnalyticsTracker } from '../AnalyticsTracker'
import { analytics } from '@/lib/analytics'
import { consentManager } from '@/lib/consent-manager'

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/properties',
}))

vi.mock('@/lib/analytics', () => ({
  analytics: {
    initialize: vi.fn(),
    setConsent: vi.fn(),
    track: vi.fn(),
    trackPageView: vi.fn(),
  },
}))

const consent = vi.hoisted(() => ({
  preferences: { timestamp: 0, analytics: false, performance: false },
  analyticsAllowed: false,
}))

vi.mock('@/lib/consent-manager', () => ({
  consentManager: {
    initialize: vi.fn(),
    getPreferences: () => consent.preferences,
    hasConsent: () => consent.analyticsAllowed,
    onConsentChange: vi.fn(),
  },
}))

beforeEach(() => {
  consent.preferences = { timestamp: 0, analytics: false, performance: false }
  consent.analyticsAllowed = false
})

describe('AnalyticsTracker', () => {
  it('renders nothing visible', () => {
    const { container } = render(<AnalyticsTracker />)

    expect(container).toBeEmptyDOMElement()
  })

  it('initializes the consent manager without tracking when no consent was given', () => {
    render(<AnalyticsTracker />)

    expect(consentManager.initialize).toHaveBeenCalled()
    expect(analytics.initialize).not.toHaveBeenCalled()
    expect(analytics.trackPageView).not.toHaveBeenCalled()
  })

  it('does not track page views before analytics consent', () => {
    consent.preferences = { timestamp: 1, analytics: false, performance: false }

    render(<AnalyticsTracker />)

    expect(analytics.initialize).not.toHaveBeenCalled()
    expect(analytics.trackPageView).not.toHaveBeenCalled()
  })

  it('initializes analytics and tracks the current page once analytics consent is given', () => {
    consent.preferences = { timestamp: 1, analytics: true, performance: false }
    consent.analyticsAllowed = true

    render(<AnalyticsTracker />)

    expect(analytics.setConsent).toHaveBeenCalledWith({ analytics: true })
    expect(analytics.initialize).toHaveBeenCalled()
    expect(analytics.trackPageView).toHaveBeenCalledWith('/en/properties')
  })
})
