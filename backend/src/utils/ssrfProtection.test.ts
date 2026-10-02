import { describe, expect, it } from 'vitest'
import { validateUrlForSSRF, revalidateUrlForSSRF } from './ssrfProtection.js'

describe('ssrfProtection', () => {
  describe('validateUrlForSSRF', () => {
    it('accepts valid HTTPS URLs to public domains', () => {
      expect(() => validateUrlForSSRF('https://example.com/webhook')).not.toThrow()
      expect(() => validateUrlForSSRF('https://api.example.com/hooks')).not.toThrow()
      expect(() => validateUrlForSSRF('https://sub.domain.example.com/webhook')).not.toThrow()
    })

    it('rejects HTTP URLs', () => {
      expect(() => validateUrlForSSRF('http://example.com/webhook')).toThrow('URL must use HTTPS protocol')
    })

    it('rejects localhost hostnames', () => {
      expect(() => validateUrlForSSRF('https://localhost/webhook')).toThrow('URL cannot point to localhost')
      expect(() => validateUrlForSSRF('https://localhost.localdomain/webhook')).toThrow('URL cannot point to localhost')
    })

    it('rejects private IP ranges', () => {
      // 10.0.0.0/8
      expect(() => validateUrlForSSRF('https://10.0.0.1/webhook')).toThrow('URL cannot point to private IP addresses')
      expect(() => validateUrlForSSRF('https://10.255.255.255/webhook')).toThrow('URL cannot point to private IP addresses')

      // 172.16.0.0/12
      expect(() => validateUrlForSSRF('https://172.16.0.1/webhook')).toThrow('URL cannot point to private IP addresses')
      expect(() => validateUrlForSSRF('https://172.31.255.255/webhook')).toThrow('URL cannot point to private IP addresses')
      expect(() => validateUrlForSSRF('https://172.15.255.255/webhook')).not.toThrow() // Just outside range
      expect(() => validateUrlForSSRF('https://172.32.0.1/webhook')).not.toThrow() // Just outside range

      // 192.168.0.0/16
      expect(() => validateUrlForSSRF('https://192.168.0.1/webhook')).toThrow('URL cannot point to private IP addresses')
      expect(() => validateUrlForSSRF('https://192.168.255.255/webhook')).toThrow('URL cannot point to private IP addresses')
      expect(() => validateUrlForSSRF('https://192.167.255.255/webhook')).not.toThrow() // Just outside range
      expect(() => validateUrlForSSRF('https://192.169.0.1/webhook')).not.toThrow() // Just outside range

      // 127.0.0.0/8 (loopback)
      expect(() => validateUrlForSSRF('https://127.0.0.1/webhook')).toThrow('URL cannot point to private IP addresses')
      expect(() => validateUrlForSSRF('https://127.255.255.255/webhook')).toThrow('URL cannot point to private IP addresses')

      // 169.254.0.0/16 (link-local)
      expect(() => validateUrlForSSRF('https://169.254.0.1/webhook')).toThrow('URL cannot point to private IP addresses')

      // 0.0.0.0/8
      expect(() => validateUrlForSSRF('https://0.0.0.0/webhook')).toThrow('URL cannot point to private IP addresses')
    })

    it('rejects multicast and reserved ranges', () => {
      expect(() => validateUrlForSSRF('https://224.0.0.1/webhook')).toThrow('URL cannot point to private IP addresses')
      expect(() => validateUrlForSSRF('https://240.0.0.1/webhook')).toThrow('URL cannot point to private IP addresses')
      expect(() => validateUrlForSSRF('https://255.255.255.255/webhook')).toThrow('URL cannot point to private IP addresses')
    })

    it('rejects IPv6 addresses', () => {
      expect(() => validateUrlForSSRF('https://[::1]/webhook')).toThrow('IPv6 addresses are not supported')
      expect(() => validateUrlForSSRF('https://[2001:db8::1]/webhook')).toThrow('IPv6 addresses are not supported')
    })

    it('rejects non-fully qualified domain names', () => {
      expect(() => validateUrlForSSRF('https://internal/webhook')).toThrow('URL must use a fully qualified domain name')
      expect(() => validateUrlForSSRF('https://myhost/webhook')).toThrow('URL must use a fully qualified domain name')
    })

    it('rejects invalid URL format', () => {
      expect(() => validateUrlForSSRF('not-a-url')).toThrow('Invalid URL format')
      expect(() => validateUrlForSSRF('')).toThrow('Invalid URL format')
    })
  })

  describe('revalidateUrlForSSRF', () => {
    it('returns true for valid URLs', () => {
      expect(revalidateUrlForSSRF('https://example.com/webhook')).toBe(true)
      expect(revalidateUrlForSSRF('https://api.example.com/hooks')).toBe(true)
    })

    it('returns false for invalid URLs', () => {
      expect(revalidateUrlForSSRF('https://localhost/webhook')).toBe(false)
      expect(revalidateUrlForSSRF('https://192.168.1.1/webhook')).toBe(false)
      expect(revalidateUrlForSSRF('http://example.com/webhook')).toBe(false)
      expect(revalidateUrlForSSRF('not-a-url')).toBe(false)
    })
  })
})
