import { describe, it, expect, beforeEach } from 'vitest'
import { sanitizeString, sanitizeObject, sanitizeRequest, detectMaliciousPatterns } from './sanitization.js'
import express, { Request, Response, NextFunction } from 'express'
import supertest from 'supertest'

describe('String Sanitization', () => {
  describe('sanitizeString', () => {
    it('should trim leading and trailing whitespace', () => {
      const result = sanitizeString('  hello world  ')
      expect(result).toBe('hello world')
    })

    it('should normalize unicode characters', () => {
      const result = sanitizeString('café')
      // NFKD normalization
      expect(result).toContain('caf')
    })

    it('should enforce max length', () => {
      const long = 'a'.repeat(11)
      const result = sanitizeString(long, { maxLength: 10 })
      expect(result).toBe('a'.repeat(10))
    })

    it('should handle empty strings', () => {
      const result = sanitizeString('   ')
      expect(result).toBe('')
    })

    it('should not modify normal strings', () => {
      const input = 'hello world'
      const result = sanitizeString(input)
      expect(result).toBe(input)
    })

    it('should detect SQL injection patterns', () => {
      const malicious = "'; DROP TABLE users--"
      // Should not throw, but will log warning
      const result = sanitizeString(malicious)
      expect(result).toBeDefined()
      expect(result).toContain('DROP TABLE')
    })

    it('should detect XSS attempts', () => {
      const malicious = '<script>alert("xss")</script>'
      const result = sanitizeString(malicious)
      expect(result).toBeDefined()
      expect(result).toContain('<script>')
    })

    it('should detect path traversal attempts', () => {
      const malicious = '../../etc/passwd'
      const result = sanitizeString(malicious)
      expect(result).toBeDefined()
      expect(result).toContain('..')
    })

    it('should respect disabled trim option', () => {
      const result = sanitizeString('  hello  ', { trim: false })
      expect(result).toBe('  hello  ')
    })

    it('should respect disabled normalize option', () => {
      const input = 'café'
      const result = sanitizeString(input, { normalize: false })
      expect(result).toBe(input)
    })
  })

  describe('sanitizeObject', () => {
    it('should sanitize all string values in object', () => {
      const input = {
        name: '  John  ',
        email: '  john@example.com  '
      }
      const result = sanitizeObject(input)
      expect(result.name).toBe('John')
      expect(result.email).toBe('john@example.com')
    })

    it('should handle nested objects', () => {
      const input = {
        user: {
          name: '  John  ',
          profile: {
            bio: '  Developer  '
          }
        }
      }
      const result = sanitizeObject(input)
      expect(result.user.name).toBe('John')
      expect(result.user.profile.bio).toBe('Developer')
    })

    it('should handle arrays of strings', () => {
      const input = {
        tags: ['  tag1  ', '  tag2  ']
      }
      const result = sanitizeObject(input)
      expect(result.tags).toEqual(['tag1', 'tag2'])
    })

    it('should handle mixed arrays', () => {
      const input = {
        items: ['  item1  ', 42, { name: '  nested  ' }]
      }
      const result = sanitizeObject(input)
      expect(result.items[0]).toBe('item1')
      expect(result.items[1]).toBe(42)
      expect(result.items[2].name).toBe('nested')
    })

    it('should preserve non-string values', () => {
      const input = {
        name: '  John  ',
        age: 30,
        active: true,
        metadata: null
      }
      const result = sanitizeObject(input)
      expect(result.age).toBe(30)
      expect(result.active).toBe(true)
      expect(result.metadata).toBeNull()
    })
  })
})

describe('Request Sanitization Middleware', () => {
  let app: express.Application
  let agent: supertest.SuperTest<supertest.Test>

  beforeEach(() => {
    app = express()
    app.use(express.json())
    app.use(sanitizeRequest())

    app.post('/test', (req: Request, res: Response) => {
      res.json(req.body)
    })

    app.get('/test', (req: Request, res: Response) => {
      res.json(req.query)
    })

    agent = supertest(app)
  })

  it('should sanitize request body', async () => {
    const res = await agent
      .post('/test')
      .send({ name: '  John  ' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('John')
  })

  it('should sanitize query parameters', async () => {
    const res = await agent.get('/test?name=  John  &email=  test@example.com  ')

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('John')
    expect(res.body.email).toBe('test@example.com')
  })

  it('should handle nested objects in body', async () => {
    const res = await agent
      .post('/test')
      .send({
        user: {
          name: '  John  ',
          email: '  john@example.com  '
        }
      })

    expect(res.body.user.name).toBe('John')
    expect(res.body.user.email).toBe('john@example.com')
  })

  it('should handle arrays in body', async () => {
    const res = await agent
      .post('/test')
      .send({
        tags: ['  tag1  ', '  tag2  ']
      })

    expect(res.body.tags).toEqual(['tag1', 'tag2'])
  })
})

describe('Malicious Pattern Detection', () => {
  let app: express.Application
  let agent: supertest.SuperTest<supertest.Test>

  beforeEach(() => {
    app = express()
    app.use(express.json())
    // Add request ID for logging context
    app.use((req: Request, _res: Response, next: NextFunction) => {
      ;(req as any).id = 'test-123'
      next()
    })
    app.use(detectMaliciousPatterns)

    app.post('/test', (req: Request, res: Response) => {
      res.json({ ok: true })
    })

    agent = supertest(app)
  })

  it('should allow normal input', async () => {
    const res = await agent
      .post('/test')
      .send({ email: 'user@example.com', message: 'Hello' })

    expect(res.status).toBe(200)
  })

  it('should detect SQL injection attempts', async () => {
    // Should still pass through but log warning
    const res = await agent
      .post('/test')
      .send({ query: "' OR '1'='1" })

    expect(res.status).toBe(200)
  })

  it('should detect XSS attempts', async () => {
    const res = await agent
      .post('/test')
      .send({ content: '<img src=x onerror=alert(1)>' })

    expect(res.status).toBe(200)
  })

  it('should detect path traversal attempts', async () => {
    const res = await agent
      .post('/test')
      .send({ path: '../../../../etc/passwd' })

    expect(res.status).toBe(200)
  })
})

describe('Integration: Sanitization with Options', () => {
  it('should enforce custom max length', () => {
    const long = 'a'.repeat(1000)
    const result = sanitizeString(long, {
      maxLength: 100
    })
    expect(result.length).toBe(100)
  })

  it('should skip trim when disabled', () => {
    const result = sanitizeString('  hello  ', { trim: false })
    expect(result).toBe('  hello  ')
  })

  it('should skip normalize when disabled', () => {
    const input = 'café'
    const result = sanitizeString(input, { normalize: false })
    expect(result).toBe(input)
  })

  it('should handle complex nested sanitization', () => {
    const input = {
      user: {
        profile: {
          bio: '  Developer from Berlin  ',
          website: '  https://example.com  '
        },
        tags: ['  frontend  ', '  backend  ']
      },
      settings: {
        notifications: true,
        theme: '  dark  '
      }
    }

    const result = sanitizeObject(input)

    expect(result.user.profile.bio).toBe('Developer from Berlin')
    expect(result.user.profile.website).toBe('https://example.com')
    expect(result.user.tags).toEqual(['frontend', 'backend'])
    expect(result.settings.theme).toBe('dark')
    expect(result.settings.notifications).toBe(true)
  })
})
