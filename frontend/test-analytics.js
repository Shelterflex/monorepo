// Analytics validation and testing script
// Copy and paste this into your browser's developer console when running the app

async function runAnalyticsTests() {
  console.log('📊 Running Analytics Tests...\n');
  
  const results = {
    eventTracking: { passed: false, details: [] },
    funnelAnalysis: { passed: false, details: [] },
    performanceTracking: { passed: false, details: [] },
    consentManagement: { passed: false, details: [] },
    dataValidation: { passed: false, details: [] }
  };

  // Test 1: Event Tracking
  try {
    console.log('🎯 Testing Event Tracking...');
    
    // Check if analytics is available
    if (typeof window !== 'undefined' && window.analytics) {
      results.eventTracking.details.push('✅ Analytics module available');
    } else {
      results.eventTracking.details.push('❌ Analytics module not available');
      throw new Error('Analytics module not found');
    }

    // Test consent setup
    const consent = window.analytics.getConsent();
    if (typeof consent === 'object') {
      results.eventTracking.details.push('✅ Consent system working');
    } else {
      results.eventTracking.details.push('❌ Consent system failed');
    }

    // Test event tracking
    window.analytics.setConsent({ analytics: true });
    window.analytics.track('test_event', { test: 'value' });
    
    const events = window.analytics.getEvents();
    if (events.length > 0) {
      results.eventTracking.details.push('✅ Event tracking working');
      results.eventTracking.passed = true;
    } else {
      results.eventTracking.details.push('❌ No events tracked');
    }

  } catch (error) {
    results.eventTracking.details.push(`❌ Error: ${error.message}`);
  }

  // Test 2: Funnel Analysis
  try {
    console.log('🔄 Testing Funnel Analysis...');
    
    if (typeof window !== 'undefined' && window.funnelAnalysis) {
      results.funnelAnalysis.details.push('✅ Funnel analysis module available');
    } else {
      results.funnelAnalysis.details.push('❌ Funnel analysis module not available');
      throw new Error('Funnel analysis module not found');
    }

    // Test funnel definition
    const funnels = window.funnelAnalysis.getAllFunnelDefinitions();
    if (funnels.length > 0) {
      results.funnelAnalysis.details.push(`✅ ${funnels.length} funnel definitions found`);
    } else {
      results.funnelAnalysis.details.push('❌ No funnel definitions found');
    }

    // Test funnel tracking
    const testUserId = 'test_user_' + Date.now();
    window.funnelAnalysis.startFunnel('user_registration', testUserId);
    window.funnelAnalysis.trackStep('user_registration', testUserId, 'visit_signup');
    
    const funnelData = window.funnelAnalysis.getFunnelAnalytics('user_registration');
    if (funnelData && funnelData.totalUsers > 0) {
      results.funnelAnalysis.details.push('✅ Funnel tracking working');
      results.funnelAnalysis.passed = true;
    } else {
      results.funnelAnalysis.details.push('❌ Funnel tracking failed');
    }

  } catch (error) {
    results.funnelAnalysis.details.push(`❌ Error: ${error.message}`);
  }

  // Test 3: Performance Tracking
  try {
    console.log('⚡ Testing Performance Tracking...');
    
    if (typeof window !== 'undefined' && window.performanceTracking) {
      results.performanceTracking.details.push('✅ Performance tracking module available');
    } else {
      results.performanceTracking.details.push('❌ Performance tracking module not available');
      throw new Error('Performance tracking module not found');
    }

    // Test performance metrics
    window.performanceTracking.startTracking();
    const metrics = window.performanceTracking.getMetrics();
    
    if (typeof metrics === 'object' && Object.keys(metrics).length > 0) {
      results.performanceTracking.details.push('✅ Performance metrics available');
    } else {
      results.performanceTracking.details.push('❌ No performance metrics found');
    }

    // Test performance score
    const score = window.performanceTracking.getPerformanceScore();
    if (score && typeof score.overall === 'number') {
      results.performanceTracking.details.push('✅ Performance score calculation working');
      results.performanceTracking.passed = true;
    } else {
      results.performanceTracking.details.push('❌ Performance score calculation failed');
    }

  } catch (error) {
    results.performanceTracking.details.push(`❌ Error: ${error.message}`);
  }

  // Test 4: Consent Management
  try {
    console.log('🔒 Testing Consent Management...');
    
    if (typeof window !== 'undefined' && window.consentManager) {
      results.consentManagement.details.push('✅ Consent manager module available');
    } else {
      results.consentManagement.details.push('❌ Consent manager module not available');
      throw new Error('Consent manager module not found');
    }

    // Test consent preferences
    const preferences = window.consentManager.getPreferences();
    if (typeof preferences === 'object') {
      results.consentManagement.details.push('✅ Consent preferences available');
    } else {
      results.consentManagement.details.push('❌ Consent preferences not available');
    }

    // Test consent update
    window.consentManager.updatePreferences({ analytics: true, performance: true });
    const updatedPreferences = window.consentManager.getPreferences();
    
    if (updatedPreferences.analytics && updatedPreferences.performance) {
      results.consentManagement.details.push('✅ Consent update working');
      results.consentManagement.passed = true;
    } else {
      results.consentManagement.details.push('❌ Consent update failed');
    }

  } catch (error) {
    results.consentManagement.details.push(`❌ Error: ${error.message}`);
  }

  // Test 5: Data Validation
  try {
    console.log('🔍 Testing Data Validation...');
    
    // Test data export
    if (window.analytics && window.analytics.getEvents().length > 0) {
      results.dataValidation.details.push('✅ Event data exportable');
    } else {
      results.dataValidation.details.push('❌ No event data to export');
    }

    // Test data sanitization
    window.analytics.track('test_sanitization', {
      safe_data: 'safe_value',
      password: 'secret123',
      credit_card: '4111111111111111'
    });
    
    const sanitizedEvents = window.analytics.getEvents().filter(e => e.event === 'test_sanitization');
    if (sanitizedEvents.length > 0) {
      const eventData = sanitizedEvents[0].properties;
      if (eventData.safe_data && !eventData.password && !eventData.credit_card) {
        results.dataValidation.details.push('✅ Data sanitization working');
      } else {
        results.dataValidation.details.push('❌ Data sanitization failed');
      }
    }

    // Test data persistence
    const eventCount = window.analytics.getEvents().length;
    if (eventCount > 0) {
      results.dataValidation.details.push('✅ Data persistence working');
      results.dataValidation.passed = true;
    } else {
      results.dataValidation.details.push('❌ No data persisted');
    }

  } catch (error) {
    results.dataValidation.details.push(`❌ Error: ${error.message}`);
  }

  // Generate Report
  console.log('\n📊 ANALYTICS TEST REPORT');
  console.log('========================\n');
  
  const overall = Object.values(results).every(r => r.passed);
  console.log(`Overall Status: ${overall ? '✅ PASSED' : '⚠️ ISSUES DETECTED'}\n`);
  
  const sections = [
    { name: 'Event Tracking', key: 'eventTracking' },
    { name: 'Funnel Analysis', key: 'funnelAnalysis' },
    { name: 'Performance Tracking', key: 'performanceTracking' },
    { name: 'Consent Management', key: 'consentManagement' },
    { name: 'Data Validation', key: 'dataValidation' }
  ];
  
  sections.forEach(({ name, key }) => {
    const result = results[key];
    console.log(`${name}: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
    result.details.forEach(detail => console.log(`  ${detail}`));
    console.log('');
  });
  
  console.log('🔍 Analytics Recommendations:');
  console.log('  • Ensure user consent is obtained before tracking');
  console.log('  • Monitor performance metrics regularly');
  console.log('  • Analyze funnel conversion rates');
  console.log('  • Validate data quality and accuracy');
  console.log('  • Review privacy compliance requirements');
  
  return { overall, results };
}

// Test individual components
function testEventTracking() {
  console.log('🎯 Testing Event Tracking...');
  
  if (!window.analytics) {
    console.error('❌ Analytics module not available');
    return false;
  }
  
  // Enable analytics
  window.analytics.setConsent({ analytics: true });
  
  // Test different event types
  window.analytics.track('page_view', { page: '/test' });
  window.analytics.track('user_action', { action: 'click', element: 'button' });
  window.analytics.track('conversion', { type: 'signup', value: 1 });
  
  const events = window.analytics.getEvents();
  console.log(`✅ Tracked ${events.length} events`);
  
  return events.length > 0;
}

function testFunnelTracking() {
  console.log('🔄 Testing Funnel Tracking...');
  
  if (!window.funnelAnalysis) {
    console.error('❌ Funnel analysis module not available');
    return false;
  }
  
  const testUserId = 'test_user_' + Date.now();
  
  // Start a funnel
  window.funnelAnalysis.startFunnel('user_registration', testUserId);
  window.funnelAnalysis.trackStep('user_registration', testUserId, 'visit_signup');
  window.funnelAnalysis.trackStep('user_registration', testUserId, 'start_registration');
  window.funnelAnalysis.completeFunnel('user_registration', testUserId);
  
  const analytics = window.funnelAnalysis.getFunnelAnalytics('user_registration');
  if (analytics) {
    console.log(`✅ Funnel analytics: ${analytics.totalUsers} users, ${(analytics.conversionRate * 100).toFixed(1)}% conversion`);
    return true;
  }
  
  return false;
}

function testPerformanceTracking() {
  console.log('⚡ Testing Performance Tracking...');
  
  if (!window.performanceTracking) {
    console.error('❌ Performance tracking module not available');
    return false;
  }
  
  // Start tracking
  window.performanceTracking.startTracking();
  
  // Wait a bit for metrics to collect
  setTimeout(() => {
    const metrics = window.performanceTracking.getMetrics();
    const score = window.performanceTracking.getPerformanceScore();
    
    console.log('✅ Performance metrics collected:', Object.keys(metrics));
    console.log(`✅ Performance score: ${score.overall.toFixed(1)}/100`);
  }, 1000);
  
  return true;
}

function testConsentManagement() {
  console.log('🔒 Testing Consent Management...');
  
  if (!window.consentManager) {
    console.error('❌ Consent manager module not available');
    return false;
  }
  
  // Test consent updates
  window.consentManager.updatePreferences({
    analytics: true,
    performance: true,
    functional: false,
    marketing: false
  });
  
  const preferences = window.consentManager.getPreferences();
  console.log('✅ Consent preferences updated:', preferences);
  
  // Test cookie info
  const cookieInfo = window.consentManager.getCookieInfo();
  console.log(`✅ Cookie info: ${cookieInfo.total} active cookies`);
  
  return true;
}

// Auto-run if in browser
if (typeof window !== 'undefined') {
  // Make modules available globally for testing
  if (typeof module !== 'undefined' && module.exports) {
    window.analytics = module.exports.analytics;
    window.funnelAnalysis = module.exports.funnelAnalysis;
    window.performanceTracking = module.exports.performanceTracking;
    window.consentManager = module.exports.consentManager;
  }
  
  // Uncomment the line below to auto-run tests
  // runAnalyticsTests();
}

// Export for manual execution
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { 
    runAnalyticsTests,
    testEventTracking,
    testFunnelTracking,
    testPerformanceTracking,
    testConsentManagement
  };
}
