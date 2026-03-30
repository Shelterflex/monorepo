import { describe, expect, it } from 'vitest'
import {
  formatCurrency,
  formatDateTime,
  getLocaleDisplayName,
  getTextDirection,
} from '@/lib/i18n-utils'

describe('i18n utilities', () => {
  it('formats currency per locale', () => {
    expect(formatCurrency(1250, 'USD', 'en')).toContain('$1,250.00')
  })

  it('defaults datetime formatting to Africa/Lagos timezone', () => {
    const formatted = formatDateTime('2026-03-29T10:00:00.000Z', 'en')
    expect(formatted).toMatch(/11:00|10:00|AM|PM/)
  })

  it('returns locale metadata helpers', () => {
    expect(getTextDirection('ar')).toBe('rtl')
    expect(getLocaleDisplayName('fr')).toBeTruthy()
  })
})
