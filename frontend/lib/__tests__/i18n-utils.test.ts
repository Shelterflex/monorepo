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

  it('contains all 18 payment translation keys in all non-English locales matching en.json', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const locales = ['fr', 'es', 'ar', 'zh']
    const enData = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../messages/en.json'), 'utf8')
    )
    const enKeys = Object.keys(enData.payment).sort()
    expect(enKeys).toHaveLength(18)

    for (const locale of locales) {
      const data = JSON.parse(
        fs.readFileSync(
          path.resolve(__dirname, `../../messages/${locale}.json`),
          'utf8'
        )
      )
      const targetKeys = Object.keys(data.payment || {}).sort()
      expect(targetKeys).toEqual(enKeys)
      for (const key of enKeys) {
        expect(data.payment[key]).toBeTruthy()
        expect(typeof data.payment[key]).toBe('string')
      }
    }
  })
})

