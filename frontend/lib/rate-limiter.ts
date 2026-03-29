interface RateLimitConfig {
  maxRequests: number
  windowMs: number
  skipSuccessfulRequests?: boolean
  skipFailedRequests?: boolean
}

interface RateLimitEntry {
  count: number
  resetTime: number
  lastRequest: number
}

class RateLimiter {
  private static instances: Map<string, RateLimiter> = new Map()
  private requests: Map<string, RateLimitEntry> = new Map()
  private config: RateLimitConfig
  private storageKey: string

  constructor(config: RateLimitConfig, storageKey = 'rate_limit') {
    this.config = config
    this.storageKey = storageKey
    this.loadFromStorage()
  }

  static getInstance(key: string, config?: RateLimitConfig): RateLimiter {
    if (!RateLimiter.instances.has(key)) {
      const defaultConfig: RateLimitConfig = {
        maxRequests: 100,
        windowMs: 15 * 60 * 1000, // 15 minutes
      }
      RateLimiter.instances.set(key, new RateLimiter(config || defaultConfig, key))
    }
    return RateLimiter.instances.get(key)!
  }

  private loadFromStorage(): void {
    if (typeof globalThis === 'undefined') return
    
    try {
      const stored = globalThis.localStorage?.getItem(this.storageKey)
      if (stored) {
        const data = JSON.parse(stored)
        this.requests = new Map(Object.entries(data))
      }
    } catch (error) {
      console.warn('Failed to load rate limit data from storage:', error)
    }
  }

  private saveToStorage(): void {
    if (typeof globalThis === 'undefined') return
    
    try {
      const data = Object.fromEntries(this.requests)
      globalThis.localStorage?.setItem(this.storageKey, JSON.stringify(data))
    } catch (error) {
      console.warn('Failed to save rate limit data to storage:', error)
    }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.requests.entries()) {
      if (now > entry.resetTime) {
        this.requests.delete(key)
      }
    }
    this.saveToStorage()
  }

  checkLimit(identifier: string = 'default'): { allowed: boolean; remaining: number; resetTime: number } {
    this.cleanup()
    
    const now = Date.now()
    const entry = this.requests.get(identifier)

    if (!entry || now > entry.resetTime) {
      const newEntry: RateLimitEntry = {
        count: 1,
        resetTime: now + this.config.windowMs,
        lastRequest: now
      }
      this.requests.set(identifier, newEntry)
      this.saveToStorage()
      
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetTime: newEntry.resetTime
      }
    }

    const timeSinceLastRequest = now - entry.lastRequest
    
    // Check if the window has reset
    if (timeSinceLastRequest >= this.config.windowMs) {
      entry.count = 1
      entry.resetTime = now + this.config.windowMs
      entry.lastRequest = now
      this.saveToStorage()
      
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetTime: entry.resetTime
      }
    }

    // Check if limit exceeded
    if (entry.count >= this.config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime
      }
    }

    // Increment counter
    entry.count++
    entry.lastRequest = now
    this.saveToStorage()

    return {
      allowed: true,
      remaining: this.config.maxRequests - entry.count,
      resetTime: entry.resetTime
    }
  }

  reset(identifier?: string): void {
    if (identifier) {
      this.requests.delete(identifier)
    } else {
      this.requests.clear()
    }
    this.saveToStorage()
  }

  getStatus(identifier: string = 'default'): { count: number; remaining: number; resetTime: number } {
    const entry = this.requests.get(identifier)
    const now = Date.now()

    if (!entry || now > entry.resetTime) {
      return {
        count: 0,
        remaining: this.config.maxRequests,
        resetTime: now + this.config.windowMs
      }
    }

    return {
      count: entry.count,
      remaining: Math.max(0, this.config.maxRequests - entry.count),
      resetTime: entry.resetTime
    }
  }
}

// API rate limiter with different tiers
export const apiRateLimiters = {
  // General API calls
  general: RateLimiter.getInstance('api_general', {
    maxRequests: 100,
    windowMs: 15 * 60 * 1000, // 15 minutes
  }),

  // Authentication endpoints (more restrictive)
  auth: RateLimiter.getInstance('api_auth', {
    maxRequests: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
  }),

  // Sensitive operations (very restrictive)
  sensitive: RateLimiter.getInstance('api_sensitive', {
    maxRequests: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
  }),

  // File uploads
  upload: RateLimiter.getInstance('api_upload', {
    maxRequests: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
  })
}

// Rate limiting decorator for API functions
export function withRateLimit<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  limiter: RateLimiter,
  identifier?: string | ((args: Parameters<T>) => string)
): T {
  return (async (...args: Parameters<T>) => {
    const id = typeof identifier === 'function' 
      ? identifier(args)
      : identifier || 'default'

    const check = limiter.checkLimit(id)
    
    if (!check.allowed) {
      const error = new Error('Rate limit exceeded') as any
      error.status = 429
      error.remaining = check.remaining
      error.resetTime = check.resetTime
      throw error
    }

    try {
      const result = await fn(...args)
      
      if (limiter['config'].skipSuccessfulRequests) {
        // Rollback the counter for successful requests if configured
        const entry = limiter['requests'].get(id)
        if (entry) {
          entry.count = Math.max(0, entry.count - 1)
        }
      }
      
      return result
    } catch (error) {
      if (!limiter['config'].skipFailedRequests) {
        // Rollback the counter for failed requests if configured
        const entry = limiter['requests'].get(id)
        if (entry) {
          entry.count = Math.max(0, entry.count - 1)
        }
      }
      throw error
    }
  }) as T
}

export default RateLimiter
