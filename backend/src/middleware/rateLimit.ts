import net from 'node:net'
import tls from 'node:tls'
import type { RequestHandler, Request, Response, NextFunction } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import type { Env } from '../schemas/env.js'
import { slidingWindowLimiter } from '../services/SlidingWindowLimiter.js'
import { quotaService } from '../services/QuotaService.js'
import type { User } from '../repositories/AuthRepository.js'

type RateLimitState = {
  totalHits: number
  resetAt: Date
}

type RateLimitRule = {
  maxRequests: number
  windowMs: number
  message: string
}

type RespValue = string | number | null | RespValue[]

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitState>
  resetKey(key: string): Promise<void>
}

class InMemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, { count: number; resetAtMs: number }>()

  async increment(key: string, windowMs: number): Promise<RateLimitState> {
    const now = Date.now()
    const current = this.counters.get(key)

    if (!current || now >= current.resetAtMs) {
      const next = { count: 1, resetAtMs: now + windowMs }
      this.counters.set(key, next)
      return { totalHits: next.count, resetAt: new Date(next.resetAtMs) }
    }

    current.count += 1
    return { totalHits: current.count, resetAt: new Date(current.resetAtMs) }
  }

  async resetKey(key: string): Promise<void> {
    this.counters.delete(key)
  }

  clear() {
    this.counters.clear()
  }
}

class RedisRateLimitStore implements RateLimitStore {
  private readonly hostname: string
  private readonly port: number
  private readonly secure: boolean
  private readonly password?: string
  private readonly username?: string
  private readonly database?: string
  private readonly keyPrefix = 'rate-limit'

  constructor(redisUrl: string) {
    const url = new URL(redisUrl)
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      throw new Error('RATE_LIMIT_REDIS_URL must use redis:// or rediss://')
    }

    this.hostname = url.hostname
    this.port = Number(url.port || (url.protocol === 'rediss:' ? 6380 : 6379))
    this.secure = url.protocol === 'rediss:'
    this.username = url.username || undefined
    this.password = url.password || undefined
    this.database = url.pathname.replace(/^\//, '') || undefined
  }

  async increment(key: string, windowMs: number): Promise<RateLimitState> {
    const redisKey = this.toRedisKey(key)
    const commands: string[][] = []

    if (this.password) {
      commands.push(this.username ? ['AUTH', this.username, this.password] : ['AUTH', this.password])
    }
    if (this.database) {
      commands.push(['SELECT', this.database])
    }

    commands.push(['INCR', redisKey])
    commands.push(['PTTL', redisKey])

    const results = await this.sendCommands(commands)
    const count = Number(results[results.length - 2] ?? 0)
    const ttlBeforeExpire = Number(results[results.length - 1] ?? -1)

    if (count === 1 || ttlBeforeExpire < 0) {
      await this.sendRedisCommand(['PEXPIRE', redisKey, String(windowMs)])
      return {
        totalHits: count,
        resetAt: new Date(Date.now() + windowMs),
      }
    }

    return {
      totalHits: count,
      resetAt: new Date(Date.now() + ttlBeforeExpire),
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.sendRedisCommand(['DEL', this.toRedisKey(key)])
  }

  private toRedisKey(key: string) {
    return `${this.keyPrefix}:${key}`
  }

  private async sendRedisCommand(command: string[]): Promise<RespValue> {
    const commands: string[][] = []

    if (this.password) {
      commands.push(this.username ? ['AUTH', this.username, this.password] : ['AUTH', this.password])
    }
    if (this.database) {
      commands.push(['SELECT', this.database])
    }

    commands.push(command)
    const results = await this.sendCommands(commands)
    return results[results.length - 1] ?? null
  }

  private async sendCommands(commands: string[][]): Promise<RespValue[]> {
    return new Promise((resolve, reject) => {
      const socket = this.secure
        ? tls.connect({ host: this.hostname, port: this.port, servername: this.hostname })
        : net.createConnection({ host: this.hostname, port: this.port })
      const parser = new RespParser()
      const responses: RespValue[] = []

      socket.on('error', reject)
      socket.on('data', (chunk: Buffer) => {
        try {
          parser.push(chunk)
          while (parser.hasValue()) {
            responses.push(parser.readValue())
            if (responses.length === commands.length) {
              socket.end()
            }
          }
        } catch (error) {
          reject(error)
          socket.destroy()
        }
      })
      socket.on('end', () => resolve(responses))

      socket.on('connect', () => {
        const payload = commands.map(encodeRespArray).join('')
        socket.write(payload)
      })
    })
  }
}

class RespParser {
  private buffer = Buffer.alloc(0)
  private offset = 0

  push(chunk: Buffer) {
    if (this.offset === 0) {
      this.buffer = Buffer.concat([this.buffer, chunk])
      return
    }

    this.buffer = Buffer.concat([this.buffer.subarray(this.offset), chunk])
    this.offset = 0
  }

  hasValue() {
    return this.tryParse(this.offset) !== null
  }

  readValue(): RespValue {
    const parsed = this.tryParse(this.offset)
    if (!parsed) {
      throw new Error('Incomplete Redis response')
    }

    this.offset = parsed.nextOffset
    return parsed.value
  }

  private tryParse(start: number): { value: RespValue; nextOffset: number } | null {
    if (start >= this.buffer.length) return null
    const prefix = String.fromCharCode(this.buffer[start])

    if (prefix === '+' || prefix === ':' || prefix === '-') {
      const line = this.readLine(start + 1)
      if (!line) return null
      if (prefix === '-') throw new Error(`Redis error: ${line.value}`)
      return {
        value: prefix === ':' ? Number(line.value) : line.value,
        nextOffset: line.nextOffset,
      }
    }

    if (prefix === '$') {
      const line = this.readLine(start + 1)
      if (!line) return null
      const size = Number(line.value)
      if (size === -1) {
        return { value: null, nextOffset: line.nextOffset }
      }

      const end = line.nextOffset + size
      if (end + 2 > this.buffer.length) return null
      const value = this.buffer.toString('utf8', line.nextOffset, end)
      return { value, nextOffset: end + 2 }
    }

    if (prefix === '*') {
      const line = this.readLine(start + 1)
      if (!line) return null
      const size = Number(line.value)
      if (size === -1) {
        return { value: null, nextOffset: line.nextOffset }
      }

      const values: RespValue[] = []
      let nextOffset = line.nextOffset
      for (let index = 0; index < size; index += 1) {
        const parsed = this.tryParse(nextOffset)
        if (!parsed) return null
        values.push(parsed.value)
        nextOffset = parsed.nextOffset
      }

      return { value: values, nextOffset }
    }

    throw new Error(`Unsupported Redis RESP prefix: ${prefix}`)
  }

  private readLine(start: number): { value: string; nextOffset: number } | null {
    const end = this.buffer.indexOf('\r\n', start, 'utf8')
    if (end === -1) return null

    return {
      value: this.buffer.toString('utf8', start, end),
      nextOffset: end + 2,
    }
  }
}

function encodeRespArray(parts: string[]) {
  const encoded = parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')
  return `*${parts.length}\r\n${encoded}`
}

const memoryStore = new InMemoryRateLimitStore()

export function setRetryAfterHeaders(res: Response, resetAt: Date) {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))
  res.setHeader('Retry-After', String(retryAfterSeconds))
  res.setHeader('X-RateLimit-Reset', resetAt.toISOString())
}

function buildRateLimitKey(prefix: string, req: Request) {
  const clientKey = req.ip || req.headers['x-forwarded-for'] || 'unknown'
  return `${prefix}:${String(clientKey)}`
}

function createRateLimiter(options: {
  store: RateLimitStore
  keyPrefix: string
  rule: RateLimitRule
  skip?: (req: Request) => boolean
}): RequestHandler {
  const { store, keyPrefix, rule, skip } = options

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (skip?.(req)) {
        next()
        return
      }

      const state = await store.increment(buildRateLimitKey(keyPrefix, req), rule.windowMs)
      res.setHeader('X-RateLimit-Limit', String(rule.maxRequests))
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rule.maxRequests - state.totalHits)))
      res.setHeader('X-RateLimit-Reset', state.resetAt.toISOString())

      if (state.totalHits <= rule.maxRequests) {
        next()
        return
      }

      setRetryAfterHeaders(res, state.resetAt)
      next(
        new AppError(ErrorCode.TOO_MANY_REQUESTS, 429, rule.message, {
          retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt.getTime() - Date.now()) / 1000)),
        }),
      )
    } catch (error) {
      next(error)
    }
  }
}

function createRateLimitStore(env: Env): RateLimitStore {
  if (env.RATE_LIMIT_STORE === 'redis') {
    return new RedisRateLimitStore(env.RATE_LIMIT_REDIS_URL as string)
  }

  return memoryStore
}

export function createPublicRateLimiter(env: Env) {
  return createRateLimiter({
    store: createRateLimitStore(env),
    keyPrefix: 'public',
    rule: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
      message: 'Too many requests. Please try again later.',
    },
  })
}

export function createAuthRateLimiter(env: Env) {
  return createRateLimiter({
    store: createRateLimitStore(env),
    keyPrefix: 'auth',
    rule: {
      windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
      maxRequests: env.AUTH_RATE_LIMIT_MAX_REQUESTS,
      message: 'Too many authentication attempts. Please try again later.',
    },
  })
}

export function createSensitiveRateLimiters(env: Env) {
  const store = createRateLimitStore(env)

  return {
    admin: createRateLimiter({
      store,
      keyPrefix: 'admin',
      rule: {
        windowMs: env.ADMIN_RATE_LIMIT_WINDOW_MS,
        maxRequests: env.ADMIN_RATE_LIMIT_MAX_REQUESTS,
        message: 'Too many admin requests. Please try again later.',
      },
    }),
    adminRisk: createRateLimiter({
      store,
      keyPrefix: 'admin-risk',
      rule: {
        windowMs: env.ADMIN_RISK_RATE_LIMIT_WINDOW_MS,
        maxRequests: env.ADMIN_RISK_RATE_LIMIT_MAX_REQUESTS,
        message: 'Too many admin risk requests. Please try again later.',
      },
    }),
    adminReconciliation: createRateLimiter({
      store,
      keyPrefix: 'admin-reconciliation',
      rule: {
        windowMs: env.ADMIN_RECONCILIATION_RATE_LIMIT_WINDOW_MS,
        maxRequests: env.ADMIN_RECONCILIATION_RATE_LIMIT_MAX_REQUESTS,
        message: 'Too many admin reconciliation requests. Please try again later.',
      },
    }),
    walletCreate: createRateLimiter({
      store,
      keyPrefix: 'wallet-create',
      rule: {
        windowMs: env.WALLET_CREATE_RATE_LIMIT_WINDOW_MS,
        maxRequests: env.WALLET_CREATE_RATE_LIMIT_MAX_REQUESTS,
        message: 'Too many wallet creation requests. Please try again later.',
      },
    }),
    walletSigning: createRateLimiter({
      store,
      keyPrefix: 'wallet-signing',
      rule: {
        windowMs: env.WALLET_SIGN_RATE_LIMIT_WINDOW_MS,
        maxRequests: env.WALLET_SIGN_RATE_LIMIT_MAX_REQUESTS,
        message: 'Too many wallet signing requests. Please try again later.',
      },
    }),
    ngnWithdraw: createRateLimiter({
      store,
      keyPrefix: 'wallet-ngn-withdraw',
      rule: {
        windowMs: env.NGN_WITHDRAW_RATE_LIMIT_WINDOW_MS,
        maxRequests: env.NGN_WITHDRAW_RATE_LIMIT_MAX_REQUESTS,
        message: 'Too many NGN withdrawal requests. Please try again later.',
      },
    }),
    ngnTopup: createRateLimiter({
      store,
      keyPrefix: 'wallet-ngn-topup',
      rule: {
        windowMs: env.NGN_TOPUP_RATE_LIMIT_WINDOW_MS,
        maxRequests: env.NGN_TOPUP_RATE_LIMIT_MAX_REQUESTS,
        message: 'Too many NGN top-up requests. Please try again later.',
      },
    }),
  }
}

export function _testOnly_clearRateLimitState() {
  memoryStore.clear()
}
