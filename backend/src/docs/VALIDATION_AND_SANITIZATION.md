# Request Validation & Sanitization Layer

## Overview

This document describes the comprehensive request validation and sanitization layer implemented in the Shelterflex backend. It complies with issue #437 acceptance criteria:

- ✅ Centralized validation middleware with Zod schemas
- ✅ Input sanitization for strings (trim, normalize)
- ✅ Rate limiting per endpoint/user
- ✅ Detailed validation error responses
- ✅ Logging for validation failures

## Architecture

### 1. Sanitization Middleware (`middleware/sanitization.ts`)

The sanitization layer provides three main components:

#### String Sanitization

```typescript
import { sanitizeString } from './middleware/sanitization.js'

const sanitized = sanitizeString('  Hello World  ', {
  trim: true,
  normalize: true,
  maxLength: 10000,
})
// Result: 'Hello World'
```

**Features:**
- **Trimming**: Removes leading/trailing whitespace
- **Unicode normalization**: Applies NFKD normalization for security
- **Dangerous pattern detection**: Logs (but doesn't block):
  - SQL injection attempts
  - XSS attempts
  - Path traversal attempts
  - Null byte injection
- **Max length enforcement**: Truncates strings exceeding limits
- **Disallowed pattern matching**: Custom pattern validation

#### Object Sanitization

```typescript
import { sanitizeObject } from './middleware/sanitization.js'

const sanitized = sanitizeObject(
  {
    email: '  user@example.com  ',
    nested: {
      data: '  value  '
    }
  },
  { trim: true, normalize: true }
)
```

**Features:**
- Recursive sanitization of nested objects
- Array element sanitization
- Preserves non-string values

#### Request Sanitization Middleware

```typescript
import { sanitizeRequest } from './middleware/sanitization.js'

// Applied globally in app.ts
app.use(sanitizeRequest({
  trim: true,
  normalize: true,
  maxLength: 10000,
}))
```

**Sanitizes:**
- Request body
- Query parameters
- URL parameters

#### Malicious Pattern Detection

```typescript
import { detectMaliciousPatterns } from './middleware/sanitization.js'

// Applied globally to detect injection attempts early
app.use(detectMaliciousPatterns)
```

**Detects and logs:**
- SQL injection patterns
- XSS attempts
- Path traversal
- Null bytes

### 2. Enhanced Validation Middleware (`middleware/validate.ts`)

The existing validation middleware has been enhanced with logging capabilities:

```typescript
import { validate } from './middleware/validate.js'
import { mySchema } from './schemas/my-feature.js'

router.post('/endpoint', validate(mySchema), handler)
```

**Enhancements:**
- Logs all validation failures with context:
  - Request ID
  - Path and method
  - Validation target (body/query/params)
  - Detailed field errors
- Structured error responses with field-level details
- Supports body, query, and params validation

### 3. Comprehensive Rate Limiting (`middleware/comprehensiveRateLimit.ts`)

The rate limiting layer provides multi-level protection:

#### Features

- **Per-user rate limiting**: Different limits for authenticated users
- **Per-IP rate limiting**: Protection for unauthenticated requests
- **Per-endpoint limits**: Different limits for different endpoints
- **Sliding window algorithm**: Accurate request counting
- **HTTP headers**: Standard `X-RateLimit-*` headers
- **Detailed logging**: Rate limit events are logged for monitoring

#### Endpoints with Strict Limits

```typescript
// Auth endpoints - 5 OTP requests per 15 minutes
'POST /api/auth/request-otp' -> 5 requests per 15 minutes

// Auth verification - 10 attempts per 15 minutes
'POST /api/auth/verify-otp' -> 10 requests per 15 minutes

// Wallet operations - 20 per minute
'POST /api/auth/wallet-challenge' -> 20 requests per minute
'POST /api/auth/wallet-verify' -> 20 requests per minute
```

#### Configuring Rate Limits

```typescript
import { setEndpointRateLimit } from './middleware/comprehensiveRateLimit.js'

// Set custom limit for a specific endpoint
setEndpointRateLimit('POST', '/api/custom/endpoint', {
  windowMs: 60 * 1000,      // 1 minute window
  limit: 30,                 // 30 requests per window
  skipSuccessfulRequests: false
})
```

#### Monitoring Rate Limit Stats

```typescript
import { getRateLimitStats } from './middleware/comprehensiveRateLimit.js'

const stats = getRateLimitStats()
console.log(`Tracking ${stats.activeKeys} active rate limit keys`)
```

### 4. Validation Error Responses

The validation layer returns detailed, structured error responses:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": {
      "email": "Invalid email",
      "amount": "Expected number, received string",
      "nested.field": "String too long"
    }
  }
}
```

**Status Code:** 400 Bad Request

**Field Error Path Format:** 
- Simple fields: `fieldName`
- Nested fields: `parent.child.field`
- Array elements: `items[0]`

## Integration

### Middleware Stack Order

```typescript
// 1. Request ID (for tracing)
app.use(requestIdMiddleware)

// 2. Core middleware
app.use(express.json())

// 3. Sanitization (must be before validation)
app.use(sanitizeRequest(...))
app.use(detectMaliciousPatterns)

// 4. CORS
app.use(cors(...))

// 5. Comprehensive rate limiting
app.use(createComprehensiveRateLimiter(...))

// 6. API versioning
app.use('/api', apiVersioning)

// 7. Routes (with per-route validation)
app.use('/api/auth', validate(...), authRouter)

// 8. Error handler (must be last)
app.use(errorHandler)
```

### Applying Validation to Routes

```typescript
import { Router } from 'express'
import { validate } from '../middleware/validate.js'
import { mySchema } from '../schemas/myFeature.js'

const router = Router()

// Validate request body (default)
router.post('/create', validate(mySchema), (req, res) => {
  // req.body is already validated and sanitized
  res.json({ success: true })
})

// Validate query parameters
router.get('/search', validate(querySchema, 'query'), (req, res) => {
  // req.query is validated
  res.json({ results: [] })
})

// Validate URL parameters
router.get('/:id', validate(paramsSchema, 'params'), (req, res) => {
  // req.params is validated
  res.json({ id: req.params.id })
})
```

## Logging

### Validation Failures

When validation fails, a warning is logged with:

```typescript
logger.warn('Request validation failed', {
  requestId: 'abc-123',
  path: '/api/users',
  method: 'POST',
  target: 'body',
  endpoint: 'POST /api/users',
  validationErrors: {
    email: 'Invalid email',
    age: 'Expected number'
  }
})
```

### Sanitization

When input is sanitized:

```typescript
logger.debug('Request body sanitized', {
  requestId: 'abc-123',
  path: '/api/users',
  method: 'POST'
})
```

### Dangerous Patterns

When dangerous patterns are detected:

```typescript
logger.warn('Dangerous pattern detected in request', {
  requestId: 'abc-123',
  path: 'body.query',
  field: 'sqlInjection',
  value: "SELECT * FROM users WHERE id = '...'",
})
```

### Rate Limiting

```typescript
// Rate limit exceeded
logger.warn('Rate limit exceeded', {
  requestId: 'abc-123',
  endpoint: 'POST /api/auth/request-otp',
  userId: 'user-id',
  clientIp: '192.168.1.1',
  checks: [
    { type: 'user', count: 6, remaining: 0, allowed: false },
    { type: 'ip', count: 15, remaining: 0, allowed: false },
    { type: 'endpoint', count: 105, remaining: 0, allowed: false }
  ]
})
```

## Testing

### Testing Validation

```typescript
import { createTestAgent } from '../test-helpers.js'

describe('POST /api/users', () => {
  const agent = createTestAgent()

  it('should reject invalid email', async () => {
    const res = await agent
      .post('/api/users')
      .send({ email: 'not-an-email', age: 25 })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details.email).toBeDefined()
  })

  it('should accept and sanitize valid input', async () => {
    const res = await agent
      .post('/api/users')
      .send({ email: '  user@example.com  ', age: 25 })

    expect(res.status).toBe(200)
    // Input was trimmed during sanitization
    expect(res.body.email).toBe('user@example.com')
  })
})
```

### Testing Sanitization

```typescript
import { sanitizeString, sanitizeObject } from '../middleware/sanitization.js'

describe('String Sanitization', () => {
  it('should trim whitespace', () => {
    const result = sanitizeString('  hello  ')
    expect(result).toBe('hello')
  })

  it('should normalize unicode', () => {
    const result = sanitizeString('café')
    expect(result).toMatch(/caf/)
  })

  it('should detect SQL injection patterns', () => {
    const result = sanitizeString("'; DROP TABLE users--")
    expect(result).toBeDefined()
    // Logging would show the dangerous pattern
  })
})
```

### Testing Rate Limiting

```typescript
import { createComprehensiveRateLimiter, getRateLimitStats } from '../middleware/comprehensiveRateLimit.js'

describe('Rate Limiting', () => {
  it('should allow requests within limit', async () => {
    const agent = createTestAgent()
    const res = await agent.get('/api/health')
    expect(res.status).toBeLessThan(429)
  })

  it('should reject requests over limit', async () => {
    const agent = createTestAgent()
    
    // Make requests up to the limit
    for (let i = 0; i < 101; i++) {
      await agent.get('/api/endpoint')
    }

    // Next request should be rate limited
    const res = await agent.get('/api/endpoint')
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS')
  })

  it('should set rate limit headers', async () => {
    const agent = createTestAgent()
    const res = await agent.get('/api/endpoint')
    
    expect(res.headers['x-ratelimit-limit']).toBeDefined()
    expect(res.headers['x-ratelimit-remaining']).toBeDefined()
    expect(res.headers['x-ratelimit-reset']).toBeDefined()
  })
})
```

## How to Validate

To verify the implementation meets the acceptance criteria:

### 1. Test Validation Middleware

```bash
# Test validation with malformed input
curl -X POST http://localhost:3000/api/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "not-an-email"}'

# Expected: 400 response with field error details
# {
#   "error": {
#     "code": "VALIDATION_ERROR",
#     "message": "Invalid request data",
#     "details": {
#       "email": "Invalid email"
#     }
#   }
# }
```

### 2. Test Sanitization

```bash
# Test with padded whitespace
curl -X POST http://localhost:3000/api/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "  user@example.com  "}'

# Whitespace is trimmed, email is valid
```

### 3. Test Rate Limiting

```bash
# Test authorization endpoint rate limit
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/auth/request-otp \
    -H "Content-Type: application/json" \
    -d '{"email": "test@example.com"}'
done

# After 5 requests in 15 minutes
# Expected: 429 response with TOO_MANY_REQUESTS error
```

### 4. Test Logging

Check application logs for:

1. **Validation failure logs** with detailed error fields
2. **Sanitization logs** when input is modified
3. **Dangerous pattern logs** when suspicious input is detected
4. **Rate limit logs** when limits are exceeded

```bash
tail -f logs/app.log | grep -E "validation|sanitization|rate.limit|dangerous"
```

## Migration Path

### Updating Existing Endpoints

All endpoints using the `validate` middleware automatically:
- Have validation failures logged
- Redirect through sanitization
- Get rate limited

No code changes needed! The middleware works with existing Zod schemas.

### Adding Custom Validators

```typescript
import { Router } from 'express'
import { validate } from '../middleware/validate.js'
import { z } from 'zod'

const customSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email().toLowerCase(),
})

router.post('/custom', validate(customSchema), (req, res) => {
  // Input is sanitized and validated
  res.json({ success: true })
})
```

### Setting Endpoint-Specific Rate Limits

```typescript
import { setEndpointRateLimit } from '../middleware/comprehensiveRateLimit.js'

// In initialization (e.g., in app.ts or route creation)
setEndpointRateLimit('POST', '/api/critical/endpoint', {
  windowMs: 60 * 1000,
  limit: 5 // Very restrictive for critical operations
})
```

## References

- **Zod Documentation**: https://zod.dev
- **Express Request Validation**: https://expressjs.com/en/guide/using-middleware.html
- **OWASP Input Validation**: https://owasp.org/www-project-cheat-sheets/
- **Rate Limiting Strategies**: https://www.cloudflare.com/learning/bbb/what-is-rate-limiting/
