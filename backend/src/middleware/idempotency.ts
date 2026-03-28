import type { Request, Response, NextFunction } from 'express'
import { ErrorCode } from '../errors/errorCodes.js'
import type { ErrorResponse } from '../errors/errorCodes.js'

/**
 * Cached response stored for idempotent requests.
 */
interface CachedResponse {
  status: number
  body: unknown
  createdAt: number
}

/**
 * Store interface for deduplication entries.
 * Default implementation is in-memory with TTL eviction.
 * Swap to a Redis-backed implementation for distributed deployments.
 */
export interface IdempotencyStore {
  get(key: string): CachedResponse | undefined
  set(key: string, value: CachedResponse): void
  has(key: string): boolean
  markInFlight(key: string): boolean
  clearInFlight(key: string): void
}

/**
 * In-memory idempotency store with automatic TTL eviction.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private cache = new Map<string, CachedResponse>()
  private inFlight = new Set<string>()
  private readonly ttlMs: number
  private evictionTimer: ReturnType<typeof setInterval> | null = null

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs
    this.evictionTimer = setInterval(() => this.evict(), Math.max(ttlMs, 60_000))
    // Allow Node to exit even if the timer is running
    if (this.evictionTimer.unref) this.evictionTimer.unref()
  }

  get(key: string): CachedResponse | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key)
      return undefined
    }
    return entry
  }

  set(key: string, value: CachedResponse): void {
    this.cache.set(key, value)
    this.inFlight.delete(key)
  }

  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key)
      return false
    }
    return true
  }

  markInFlight(key: string): boolean {
    if (this.inFlight.has(key)) return false
    this.inFlight.add(key)
    return true
  }

  clearInFlight(key: string): void {
    this.inFlight.delete(key)
  }

  private evict(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.ttlMs) {
        this.cache.delete(key)
      }
    }
  }

  /** Exposed for testing */
  get size(): number {
    return this.cache.size
  }

  stop(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer)
      this.evictionTimer = null
    }
  }
}

// Default deduplication window: 5 minutes
const DEFAULT_DEDUP_WINDOW_MS = parseInt(process.env.IDEMPOTENCY_TTL_MS ?? '300000', 10)

const defaultStore = new InMemoryIdempotencyStore(DEFAULT_DEDUP_WINDOW_MS)

/**
 * Middleware that enforces idempotency using the `x-idempotency-key` header.
 *
 * - If the key was seen before and the original response is cached, replay it.
 * - If the key is currently in-flight, respond 409 Conflict.
 * - Otherwise, let the request through and cache the response.
 *
 * @param store  Optional custom store (defaults to in-memory with TTL).
 */
export function idempotency(store: IdempotencyStore = defaultStore) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['x-idempotency-key']

    if (typeof key !== 'string' || key.trim() === '') {
      const body: ErrorResponse = {
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Missing or empty x-idempotency-key header',
        },
      }
      res.status(400).json(body)
      return
    }

    const trimmedKey = key.trim()

    // Key length guard to prevent memory abuse
    if (trimmedKey.length > 256) {
      const body: ErrorResponse = {
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'x-idempotency-key must not exceed 256 characters',
        },
      }
      res.status(400).json(body)
      return
    }

    // Check for cached response
    const cached = store.get(trimmedKey)
    if (cached) {
      res.setHeader('x-idempotent-replay', 'true')
      res.status(cached.status).json(cached.body)
      return
    }

    // Check if request is already in-flight
    if (!store.markInFlight(trimmedKey)) {
      const body: ErrorResponse = {
        error: {
          code: ErrorCode.CONFLICT,
          message: 'A request with this idempotency key is already being processed',
        },
      }
      res.status(409).json(body)
      return
    }

    // Intercept res.json to capture the response
    const originalJson = res.json.bind(res)
    res.json = (body: unknown) => {
      store.set(trimmedKey, {
        status: res.statusCode,
        body,
        createdAt: Date.now(),
      })
      return originalJson(body)
    }

    // Clean up in-flight on close (e.g. client disconnect before response)
    res.on('close', () => {
      if (!store.has(trimmedKey)) {
        store.clearInFlight(trimmedKey)
      }
    })

    next()
  }
}

export { defaultStore }
