import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCookieConsent, POLICY_VERSION } from '../useCookieConsent'

vi.mock('@/lib/consent-manager', () => ({
  consentManager: {
    onConsentChange: vi.fn(() => vi.fn()),
    getPreferences: vi.fn(),
    consentAll: vi.fn(),
    rejectAll: vi.fn(),
    updatePreferences: vi.fn(),
  },
}))

import { consentManager } from '@/lib/consent-manager'

const mockConsentManager = vi.mocked(consentManager)

describe('useCookieConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('subscription and snapshot behavior', () => {
    it('subscribes to consent changes on mount', () => {
      const unsubscribe = vi.fn()
      mockConsentManager.onConsentChange.mockReturnValue(unsubscribe)

      const { unmount } = renderHook(() => useCookieConsent())

      expect(mockConsentManager.onConsentChange).toHaveBeenCalled()
      expect(typeof mockConsentManager.onConsentChange.mock.calls[0][0]).toBe('function')

      unmount()
    })

    it('returns null consent when no preferences exist', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      expect(result.current.consent).toBeNull()
    })

    it('returns consent record when preferences exist', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: Date.now(),
        version: '1.0',
        analytics: true,
        marketing: false,
        functional: true,
      })

      const { result } = renderHook(() => useCookieConsent())

      expect(result.current.consent).not.toBeNull()
      expect(result.current.consent?.version).toBe('1.0')
      expect(result.current.consent?.categories.analytics).toBe(true)
      expect(result.current.consent?.categories.marketing).toBe(false)
      expect(result.current.consent?.categories.functional).toBe(true)
    })

    it('converts timestamp to ISO string', () => {
      const timestamp = Date.now()
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp,
        version: '1.0',
        analytics: true,
        marketing: false,
        functional: true,
      })

      const { result } = renderHook(() => useCookieConsent())

      expect(result.current.consent?.timestamp).toBe(new Date(timestamp).toISOString())
    })

    it('isLoaded is true on client', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      expect(result.current.isLoaded).toBe(true)
    })

    it('showBanner is true when consent is null', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      expect(result.current.showBanner).toBe(true)
    })

    it('showBanner is true when policy version mismatches', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: Date.now(),
        version: '0.9',
        analytics: true,
        marketing: false,
        functional: true,
      })

      const { result } = renderHook(() => useCookieConsent())

      expect(result.current.showBanner).toBe(true)
    })

    it('showBanner is false when consent exists and version matches', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: Date.now(),
        version: POLICY_VERSION,
        analytics: true,
        marketing: false,
        functional: true,
      })

      const { result } = renderHook(() => useCookieConsent())

      expect(result.current.showBanner).toBe(false)
    })
  })

  describe('interaction with consent-manager', () => {
    it('hasConsent returns false when consent is null', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      expect(result.current.hasConsent('analytics')).toBe(false)
      expect(result.current.hasConsent('marketing')).toBe(false)
      expect(result.current.hasConsent('functional')).toBe(false)
    })

    it('hasConsent returns category status from consent record', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: Date.now(),
        version: POLICY_VERSION,
        analytics: true,
        marketing: false,
        functional: true,
      })

      const { result } = renderHook(() => useCookieConsent())

      expect(result.current.hasConsent('analytics')).toBe(true)
      expect(result.current.hasConsent('marketing')).toBe(false)
      expect(result.current.hasConsent('functional')).toBe(true)
    })

    it('acceptAll calls consentManager.consentAll', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      act(() => {
        result.current.acceptAll()
      })

      expect(mockConsentManager.consentAll).toHaveBeenCalled()
    })

    it('acceptAll closes preferences', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      act(() => {
        result.current.openPreferences()
      })
      expect(result.current.isPreferencesOpen).toBe(true)

      act(() => {
        result.current.acceptAll()
      })
      expect(result.current.isPreferencesOpen).toBe(false)
    })

    it('rejectNonEssential calls consentManager.rejectAll', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      act(() => {
        result.current.rejectNonEssential()
      })

      expect(mockConsentManager.rejectAll).toHaveBeenCalled()
    })

    it('rejectNonEssential closes preferences', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      act(() => {
        result.current.openPreferences()
      })
      expect(result.current.isPreferencesOpen).toBe(true)

      act(() => {
        result.current.rejectNonEssential()
      })
      expect(result.current.isPreferencesOpen).toBe(false)
    })

    it('updateConsent calls consentManager.updatePreferences with partial update', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      act(() => {
        result.current.updateConsent({ analytics: true })
      })

      expect(mockConsentManager.updatePreferences).toHaveBeenCalledWith({
        analytics: true,
        performance: true,
        marketing: false,
        functional: false,
      })
    })

    it('updateConsent syncs performance with analytics', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      act(() => {
        result.current.updateConsent({ analytics: true })
      })

      expect(mockConsentManager.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          analytics: true,
          performance: true,
        })
      )
    })

    it('updateConsent closes preferences', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      act(() => {
        result.current.openPreferences()
      })
      expect(result.current.isPreferencesOpen).toBe(true)

      act(() => {
        result.current.updateConsent({ analytics: true })
      })
      expect(result.current.isPreferencesOpen).toBe(false)
    })

    it('openPreferences sets isPreferencesOpen to true', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      expect(result.current.isPreferencesOpen).toBe(false)

      act(() => {
        result.current.openPreferences()
      })

      expect(result.current.isPreferencesOpen).toBe(true)
    })

    it('closePreferences sets isPreferencesOpen to false', () => {
      mockConsentManager.getPreferences.mockReturnValue({
        timestamp: 0,
        version: '1.0',
        analytics: false,
        marketing: false,
        functional: false,
      })

      const { result } = renderHook(() => useCookieConsent())

      act(() => {
        result.current.openPreferences()
      })
      expect(result.current.isPreferencesOpen).toBe(true)

      act(() => {
        result.current.closePreferences()
      })
      expect(result.current.isPreferencesOpen).toBe(false)
    })
  })
})
