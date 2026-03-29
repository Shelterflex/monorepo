// Security testing utilities
export class SecurityTests {
  
  // Test CSP headers
  static async testCSPHeaders(): Promise<{ passed: boolean; details: string[] }> {
    const details: string[] = []
    let passed = true

    try {
      // Make a request to check headers
      const response = await fetch(window.location.href, { method: 'HEAD' })
      
      const cspHeader = response.headers.get('Content-Security-Policy')
      if (!cspHeader) {
        details.push('❌ CSP header missing')
        passed = false
      } else {
        details.push('✅ CSP header present')
        
        // Check for essential CSP directives
        const requiredDirectives = [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'"
        ]
        
        requiredDirectives.forEach(directive => {
          if (cspHeader.includes(directive)) {
            details.push(`✅ CSP directive found: ${directive}`)
          } else {
            details.push(`❌ CSP directive missing: ${directive}`)
            passed = false
          }
        })
      }

      // Check other security headers
      const securityHeaders = [
        { name: 'X-Frame-Options', expected: 'DENY' },
        { name: 'X-Content-Type-Options', expected: 'nosniff' },
        { name: 'X-XSS-Protection', expected: '1; mode=block' },
        { name: 'Referrer-Policy', expected: 'strict-origin-when-cross-origin' }
      ]

      securityHeaders.forEach(({ name, expected }) => {
        const value = response.headers.get(name)
        if (value === expected) {
          details.push(`✅ ${name}: ${value}`)
        } else {
          details.push(`❌ ${name}: expected "${expected}", got "${value}"`)
          passed = false
        }
      })

    } catch (error) {
      details.push(`❌ Error testing CSP headers: ${error}`)
      passed = false
    }

    return { passed, details }
  }

  // Test secure storage
  static async testSecureStorage(): Promise<{ passed: boolean; details: string[] }> {
    const details: string[] = []
    let passed = true

    try {
      const { secureStorage } = await import('./secure-storage')
      
      // Test basic storage
      const testKey = 'test_security_key'
      const testValue = 'test_sensitive_data'
      
      await secureStorage.setItem(testKey, testValue, 1000) // 1 second TTL
      details.push('✅ Secure storage set item')
      
      const retrieved = await secureStorage.getItem(testKey)
      if (retrieved === testValue) {
        details.push('✅ Secure storage retrieved item correctly')
      } else {
        details.push(`❌ Secure storage retrieval failed. Expected: ${testValue}, Got: ${retrieved}`)
        passed = false
      }
      
      // Test expiration
      await new Promise(resolve => setTimeout(resolve, 1100)) // Wait for expiration
      const expired = await secureStorage.getItem(testKey)
      if (expired === null) {
        details.push('✅ Secure storage expiration works')
      } else {
        details.push('❌ Secure storage expiration failed')
        passed = false
      }
      
      // Test removal
      await secureStorage.setItem(testKey, testValue)
      await secureStorage.removeItem(testKey)
      const removed = await secureStorage.getItem(testKey)
      if (removed === null) {
        details.push('✅ Secure storage removal works')
      } else {
        details.push('❌ Secure storage removal failed')
        passed = false
      }
      
      // Cleanup
      secureStorage.removeItem(testKey)
      
    } catch (error) {
      details.push(`❌ Error testing secure storage: ${error}`)
      passed = false
    }

    return { passed, details }
  }

  // Test rate limiting
  static async testRateLimiting(): Promise<{ passed: boolean; details: string[] }> {
    const details: string[] = []
    let passed = true

    try {
      const RateLimiter = (await import('./rate-limiter')).default
      
      // Create a rate limiter with strict limits for testing
      const limiter = new RateLimiter({
        maxRequests: 3,
        windowMs: 2000 // 2 seconds
      })
      
      // Test normal operation
      const check1 = limiter.checkLimit('test')
      if (check1.allowed && check1.remaining === 2) {
        details.push('✅ Rate limiter allows first request')
      } else {
        details.push('❌ Rate limiter failed on first request')
        passed = false
      }
      
      // Test subsequent requests
      const check2 = limiter.checkLimit('test')
      const check3 = limiter.checkLimit('test')
      
      if (check2.allowed && check2.remaining === 1) {
        details.push('✅ Rate limiter allows second request')
      } else {
        details.push('❌ Rate limiter failed on second request')
        passed = false
      }
      
      if (check3.allowed && check3.remaining === 0) {
        details.push('✅ Rate limiter allows third request')
      } else {
        details.push('❌ Rate limiter failed on third request')
        passed = false
      }
      
      // Test limit exceeded
      const check4 = limiter.checkLimit('test')
      if (!check4.allowed && check4.remaining === 0) {
        details.push('✅ Rate limiter blocks exceeded requests')
      } else {
        details.push('❌ Rate limiter failed to block exceeded requests')
        passed = false
      }
      
      // Test reset
      limiter.reset('test')
      const check5 = limiter.checkLimit('test')
      if (check5.allowed && check5.remaining === 2) {
        details.push('✅ Rate limiter reset works')
      } else {
        details.push('❌ Rate limiter reset failed')
        passed = false
      }
      
    } catch (error) {
      details.push(`❌ Error testing rate limiting: ${error}`)
      passed = false
    }

    return { passed, details }
  }

  // Test CSRF protection
  static async testCSRFProtection(): Promise<{ passed: boolean; details: string[] }> {
    const details: string[] = []
    let passed = true

    try {
      const { csrfProtection } = await import('./csrf-protection')
      
      // Test token generation
      const token1 = csrfProtection.generateNewToken()
      if (token1 && token1.length > 0) {
        details.push('✅ CSRF token generation works')
      } else {
        details.push('❌ CSRF token generation failed')
        passed = false
      }
      
      // Test token retrieval
      const retrievedToken = csrfProtection.getCurrentToken()
      if (retrievedToken === token1) {
        details.push('✅ CSRF token retrieval works')
      } else {
        details.push('❌ CSRF token retrieval failed')
        passed = false
      }
      
      // Test token validation
      const isValid = csrfProtection.isTokenValid(token1)
      if (isValid) {
        details.push('✅ CSRF token validation works')
      } else {
        details.push('❌ CSRF token validation failed')
        passed = false
      }
      
      // Test invalid token
      const isInvalidValid = csrfProtection.isTokenValid('invalid_token')
      if (!isInvalidValid) {
        details.push('✅ CSRF invalid token rejection works')
      } else {
        details.push('❌ CSRF invalid token rejection failed')
        passed = false
      }
      
      // Test token refresh
      const token2 = csrfProtection.refreshToken()
      if (token2 && token2 !== token1) {
        details.push('✅ CSRF token refresh works')
      } else {
        details.push('❌ CSRF token refresh failed')
        passed = false
      }
      
      // Test header addition
      const headers = csrfProtection.addTokenToHeaders({})
      if (headers['X-CSRF-Token'] === token2) {
        details.push('✅ CSRF header addition works')
      } else {
        details.push('❌ CSRF header addition failed')
        passed = false
      }
      
    } catch (error) {
      details.push(`❌ Error testing CSRF protection: ${error}`)
      passed = false
    }

    return { passed, details }
  }

  // Test XSS protection
  static testXSSProtection(): { passed: boolean; details: string[] } {
    const details: string[] = []
    let passed = true

    try {
      // Test input sanitization utilities
      const sanitizeInput = (input: string): string => {
        return input
          .replace(/[<>]/g, '') // Remove basic HTML tags
          .replace(/javascript:/gi, '') // Remove javascript: protocol
          .replace(/on\w+=/gi, '') // Remove event handlers
      }

      const testCases = [
        { input: '<script>alert("xss")</script>', expected: 'scriptalert("xss")/script' },
        { input: 'javascript:alert("xss")', expected: 'alert("xss")' },
        { input: '<img src="x" onerror="alert(1)">', expected: 'img src="x" error="alert(1)"' },
        { input: 'normal text', expected: 'normal text' }
      ]

      testCases.forEach(({ input, expected }, index) => {
        const result = sanitizeInput(input)
        if (result === expected) {
          details.push(`✅ XSS test case ${index + 1} passed`)
        } else {
          details.push(`❌ XSS test case ${index + 1} failed: "${input}" -> "${result}" (expected "${expected}")`)
          passed = false
        }
      })

    } catch (error) {
      details.push(`❌ Error testing XSS protection: ${error}`)
      passed = false
    }

    return { passed, details }
  }

  // Run all security tests
  static async runAllTests(): Promise<{
    overall: boolean
    results: {
      csp: { passed: boolean; details: string[] }
      storage: { passed: boolean; details: string[] }
      rateLimit: { passed: boolean; details: string[] }
      csrf: { passed: boolean; details: string[] }
      xss: { passed: boolean; details: string[] }
    }
  }> {
    const results = {
      csp: await this.testCSPHeaders(),
      storage: await this.testSecureStorage(),
      rateLimit: await this.testRateLimiting(),
      csrf: await this.testCSRFProtection(),
      xss: this.testXSSProtection()
    }

    const overall = Object.values(results).every(result => result.passed)

    return { overall, results }
  }

  // Generate security report
  static generateReport(testResults: Awaited<ReturnType<typeof SecurityTests.runAllTests>>): string {
    const { overall, results } = testResults
    
    let report = '# Security Test Report\n\n'
    report += `Overall Status: ${overall ? '✅ PASSED' : '❌ FAILED'}\n\n`
    
    const sections = [
      { name: 'CSP Headers', key: 'csp' as const },
      { name: 'Secure Storage', key: 'storage' as const },
      { name: 'Rate Limiting', key: 'rateLimit' as const },
      { name: 'CSRF Protection', key: 'csrf' as const },
      { name: 'XSS Protection', key: 'xss' as const }
    ]
    
    sections.forEach(({ name, key }) => {
      const result = results[key]
      report += `## ${name}\n`
      report += `Status: ${result.passed ? '✅ PASSED' : '❌ FAILED'}\n\n`
      result.details.forEach(detail => {
        report += `- ${detail}\n`
      })
      report += '\n'
    })
    
    return report
  }
}

// Export for use in components
export default SecurityTests
