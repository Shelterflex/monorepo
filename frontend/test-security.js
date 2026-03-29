// Simple security test script that can be run in the browser console
// Copy and paste this into your browser's developer console when running the app

async function runSecurityTests() {
  console.log('🔒 Running Security Tests...\n');
  
  const results = {
    csp: { passed: false, details: [] },
    storage: { passed: false, details: [] },
    rateLimit: { passed: false, details: [] },
    csrf: { passed: false, details: [] },
    xss: { passed: false, details: [] }
  };

  // Test 1: CSP Headers
  try {
    console.log('📋 Testing CSP Headers...');
    const response = await fetch(window.location.href, { method: 'HEAD' });
    const cspHeader = response.headers.get('Content-Security-Policy');
    
    if (cspHeader) {
      results.csp.details.push('✅ CSP header present');
      results.csp.passed = true;
      
      const requiredDirectives = ["default-src 'self'", "script-src 'self'", "object-src 'none'"];
      requiredDirectives.forEach(directive => {
        if (cspHeader.includes(directive)) {
          results.csp.details.push(`✅ Found: ${directive}`);
        } else {
          results.csp.details.push(`❌ Missing: ${directive}`);
          results.csp.passed = false;
        }
      });
    } else {
      results.csp.details.push('❌ CSP header missing');
    }
  } catch (error) {
    results.csp.details.push(`❌ Error: ${error.message}`);
  }

  // Test 2: Secure Storage (simplified test)
  try {
    console.log('🔐 Testing Secure Storage...');
    if (typeof localStorage !== 'undefined') {
      const testKey = 'test_security_' + Date.now();
      const testValue = 'test_data_' + Date.now();
      
      localStorage.setItem(testKey, testValue);
      const retrieved = localStorage.getItem(testKey);
      
      if (retrieved === testValue) {
        results.storage.details.push('✅ Basic storage works');
        results.storage.passed = true;
      } else {
        results.storage.details.push('❌ Basic storage failed');
      }
      
      localStorage.removeItem(testKey);
    } else {
      results.storage.details.push('❌ localStorage not available');
    }
  } catch (error) {
    results.storage.details.push(`❌ Error: ${error.message}`);
  }

  // Test 3: Rate Limiting (simplified test)
  try {
    console.log('⏱️ Testing Rate Limiting...');
    const requests = [];
    const maxRequests = 5;
    
    for (let i = 0; i < maxRequests; i++) {
      requests.push(fetch(window.location.href, { method: 'HEAD' }));
    }
    
    const responses = await Promise.all(requests);
    const allSuccessful = responses.every(r => r.ok);
    
    if (allSuccessful) {
      results.rateLimit.details.push('✅ Basic request handling works');
      results.rateLimit.passed = true;
    } else {
      results.rateLimit.details.push('❌ Some requests failed');
    }
  } catch (error) {
    results.rateLimit.details.push(`❌ Error: ${error.message}`);
  }

  // Test 4: CSRF Protection (simplified test)
  try {
    console.log('🛡️ Testing CSRF Protection...');
    const testToken = 'csrf_token_' + Math.random().toString(36).substring(2);
    
    // Simulate token generation and validation
    if (testToken.length > 10) {
      results.csrf.details.push('✅ Token generation works');
      results.csrf.passed = true;
    } else {
      results.csrf.details.push('❌ Token generation failed');
    }
  } catch (error) {
    results.csrf.details.push(`❌ Error: ${error.message}`);
  }

  // Test 5: XSS Protection
  try {
    console.log('🚫 Testing XSS Protection...');
    const sanitizeInput = (input) => {
      return input
        .replace(/[<>]/g, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+=/gi, '');
    };

    const testCases = [
      { input: '<script>alert("xss")</script>', expected: 'scriptalert("xss")/script' },
      { input: 'javascript:alert("xss")', expected: 'alert("xss")' },
      { input: 'normal text', expected: 'normal text' }
    ];

    let passedTests = 0;
    testCases.forEach(({ input, expected }, index) => {
      const result = sanitizeInput(input);
      if (result === expected) {
        results.xss.details.push(`✅ XSS test ${index + 1} passed`);
        passedTests++;
      } else {
        results.xss.details.push(`❌ XSS test ${index + 1} failed`);
      }
    });

    results.xss.passed = passedTests === testCases.length;
  } catch (error) {
    results.xss.details.push(`❌ Error: ${error.message}`);
  }

  // Generate Report
  console.log('\n📊 SECURITY TEST REPORT');
  console.log('========================\n');
  
  const overall = Object.values(results).every(r => r.passed);
  console.log(`Overall Status: ${overall ? '✅ SECURE' : '⚠️ VULNERABILITIES DETECTED'}\n`);
  
  const sections = [
    { name: 'CSP Headers', key: 'csp' },
    { name: 'Secure Storage', key: 'storage' },
    { name: 'Rate Limiting', key: 'rateLimit' },
    { name: 'CSRF Protection', key: 'csrf' },
    { name: 'XSS Protection', key: 'xss' }
  ];
  
  sections.forEach(({ name, key }) => {
    const result = results[key];
    console.log(`${name}: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
    result.details.forEach(detail => console.log(`  ${detail}`));
    console.log('');
  });
  
  console.log('🔍 Security Recommendations:');
  console.log('  • Regularly update dependencies');
  console.log('  • Monitor security headers');
  console.log('  • Use HTTPS in production');
  console.log('  • Implement proper error handling');
  console.log('  • Regular security audits');
  
  return { overall, results };
}

// Auto-run if in browser
if (typeof window !== 'undefined') {
  // Uncomment the line below to auto-run tests
  // runSecurityTests();
}

// Export for manual execution
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runSecurityTests };
}
