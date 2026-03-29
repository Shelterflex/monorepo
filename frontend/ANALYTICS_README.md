# Analytics Implementation Guide

## Overview

This comprehensive analytics system provides privacy-focused user behavior tracking, funnel analysis, performance monitoring, and consent management for the Sheltaflex platform.

## Features

### 🔍 Event Tracking
- Privacy-focused event collection with automatic PII sanitization
- Custom event properties with data validation
- Session and user identification
- Page view and interaction tracking

### 🔄 Funnel Analysis
- Pre-defined funnels for key user flows:
  - User Registration
  - Property Discovery
  - Rental Application
  - Payment Setup
  - Staking Investment
  - Whistleblower Reporting
- Real-time conversion tracking
- Drop-off analysis and optimization insights

### ⚡ Performance Monitoring
- Core Web Vitals (FCP, LCP, FID, CLS, TTFB)
- Navigation timing metrics
- Resource loading analysis
- Custom performance metrics
- Performance scoring and recommendations

### 🔒 Privacy & Consent Management
- GDPR and CCPA compliant
- Granular consent categories
- Cookie management
- Data export and deletion rights
- Privacy policy integration

## Architecture

```
lib/
├── analytics.ts           # Core analytics engine
├── funnel-analysis.ts     # Funnel tracking and analysis
├── performance-tracking.ts # Performance monitoring
├── consent-manager.ts     # Privacy and consent management
├── analytics-init.ts      # Initialization and helpers
└── security-tests.ts      # Analytics testing utilities

components/
└── analytics-dashboard.tsx # Analytics visualization UI

test-analytics.js           # Browser validation script
```

## Quick Start

### 1. Initialization

The analytics system auto-initializes when imported. For manual control:

```typescript
import { initializeAnalytics } from '@/lib/analytics-init'

// Initialize analytics system
initializeAnalytics()
```

### 2. Basic Event Tracking

```typescript
import { useAnalytics } from '@/lib/analytics-init'

function MyComponent() {
  const { trackEvent, trackPage } = useAnalytics()

  const handleClick = () => {
    trackEvent('button_click', {
      button_id: 'signup',
      location: 'homepage'
    })
  }

  useEffect(() => {
    trackPage('/current-page')
  }, [])

  return <button onClick={handleClick}>Click me</button>
}
```

### 3. Funnel Tracking

```typescript
import { 
  startUserRegistration, 
  trackRegistrationStep,
  completeUserRegistration 
} from '@/lib/analytics-init'

// Start registration funnel
startUserRegistration('user123')

// Track registration steps
trackRegistrationStep('user123', 'visit_signup')
trackRegistrationStep('user123', 'enter_personal_info')

// Complete registration
completeUserRegistration('user123', { plan: 'premium' })
```

### 4. Performance Tracking

```typescript
import { usePerformanceTracking } from '@/lib/analytics-init'

function PerformanceComponent() {
  const { trackMetric, getScore } = usePerformanceTracking()

  const trackCustomMetric = () => {
    trackMetric('api_response_time', 250, 'ms')
  }

  const checkPerformance = () => {
    const score = getScore()
    console.log(`Performance score: ${score.overall}/100`)
  }

  return (
    <div>
      <button onClick={trackCustomMetric}>Track Metric</button>
      <button onClick={checkPerformance}>Check Score</button>
    </div>
  )
}
```

## API Reference

### Analytics Class

#### Methods

- `track(event, properties?)` - Track custom events
- `trackPageView(path?)` - Track page views
- `identify(userId, traits?)` - Identify users
- `getEvents(eventType?)` - Get tracked events
- `reset()` - Reset analytics data

### FunnelAnalysis Class

#### Methods

- `startFunnel(funnelName, userId, properties?)` - Start funnel tracking
- `trackStep(funnelName, userId, stepName, properties?)` - Track funnel steps
- `completeFunnel(funnelName, userId, properties?)` - Complete funnel
- `getFunnelAnalytics(funnelName)` - Get funnel analytics
- `getOptimizationInsights(funnelName)` - Get optimization recommendations

### PerformanceTracking Class

#### Methods

- `startTracking()` - Start performance monitoring
- `trackCustomMetric(name, value, unit?)` - Track custom metrics
- `getMetrics()` - Get performance metrics
- `getPerformanceScore()` - Get performance score
- `exportMetrics()` - Export metrics data

### ConsentManager Class

#### Methods

- `setConsent(preferences)` - Set consent preferences
- `getPreferences()` - Get current preferences
- `hasConsent(category)` - Check consent status
- `exportUserData()` - Export user data
- `deleteUserData()` - Delete all user data

## Privacy Features

### Data Sanitization

The system automatically sanitizes sensitive data:

- Removes PII (passwords, tokens, credit cards)
- Limits string lengths
- Filters sensitive field names
- Validates data types

### Consent Management

```typescript
import { consentManager } from '@/lib/consent-manager'

// Update consent preferences
consentManager.updatePreferences({
  analytics: true,
  performance: true,
  functional: false,
  marketing: false
})

// Check consent status
const hasAnalyticsConsent = consentManager.hasConsent('analytics')

// Get cookie information
const cookieInfo = consentManager.getCookieInfo()
```

### Data Rights

```typescript
// Export user data (GDPR/CCPA compliance)
const userData = consentManager.exportUserData()

// Delete all user data
consentManager.deleteUserData()
```

## Testing

### Browser Console Testing

1. Open browser developer console
2. Copy and paste the contents of `test-analytics.js`
3. Run `runAnalyticsTests()` to validate the implementation

### Individual Component Tests

```javascript
// Test event tracking
testEventTracking()

// Test funnel analysis
testFunnelTracking()

// Test performance tracking
testPerformanceTracking()

// Test consent management
testConsentManagement()
```

## Analytics Dashboard

Access the analytics dashboard at `/analytics` (if routed) to visualize:

- Event tracking overview
- Funnel conversion rates
- Performance metrics
- Consent status
- Real-time data updates

## Configuration

### Environment Variables

```env
# Analytics configuration
NEXT_PUBLIC_ANALYTICS_ENABLED=true
NEXT_PUBLIC_PERFORMANCE_TRACKING=true
NEXT_PUBLIC_CONSENT_REQUIRED=true

# Custom analytics endpoint (optional)
NEXT_PUBLIC_ANALYTICS_ENDPOINT=https://your-analytics-api.com
```

### Custom Funnels

```typescript
import { funnelAnalysis } from '@/lib/funnel-analysis'

// Define custom funnel
funnelAnalysis.defineFunnel({
  name: 'custom_funnel',
  description: 'Custom user flow',
  steps: [
    { name: 'step1', description: 'First step', required: true },
    { name: 'step2', description: 'Second step', required: true },
    { name: 'step3', description: 'Final step', required: false }
  ]
})
```

## Performance Optimization

- Lazy load analytics components
- Batch event transmission
- Local storage caching
- Minimal performance overhead
- Automatic cleanup of old data

## Security

- No sensitive data in events
- Encrypted storage for user data
- Rate limiting for API calls
- CSRF protection
- XSS prevention

## Compliance

### GDPR Features
- Explicit consent required
- Data portability
- Right to deletion
- Privacy by design
- Data minimization

### CCPA Features
- Do not sell tracking
- Data deletion rights
- Opt-out mechanisms
- Transparent disclosures

## Troubleshooting

### Common Issues

1. **Events not tracking**
   - Check consent preferences
   - Verify analytics initialization
   - Ensure proper event naming

2. **Performance metrics missing**
   - Enable performance consent
   - Check browser support
   - Verify timing API availability

3. **Funnel data not showing**
   - Ensure proper funnel start
   - Check user ID consistency
   - Verify step naming

### Debug Mode

```typescript
// Enable debug logging
if (process.env.NODE_ENV === 'development') {
  console.log('Analytics initialized:', analytics.isInitialized)
  console.log('Current consent:', consentManager.getPreferences())
}
```

## Best Practices

1. **Event Naming**: Use consistent, descriptive event names
2. **Properties**: Include relevant context, avoid PII
3. **Funnels**: Define clear conversion goals
4. **Performance**: Monitor Core Web Vitals regularly
5. **Privacy**: Obtain explicit consent before tracking
6. **Testing**: Validate analytics implementation regularly

## Support

For questions or issues:
- Check browser console for errors
- Run validation tests
- Review consent settings
- Verify network connectivity

---

**Version**: 1.0.0  
**Last Updated**: 2025-03-27  
**Privacy Compliant**: GDPR, CCPA
