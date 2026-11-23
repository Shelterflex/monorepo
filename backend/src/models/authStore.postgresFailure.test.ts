import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * With Postgres selected, a database error must surface as a 503 and must never
 * be answered from, or written to, a process-local copy.
 */
// Mock factories are hoisted above top-level code, so their helpers must be too.
const h = vi.hoisted(() => {
  const EMAIL = 'alice@example.com'
  const failing = (...methods: string[]) =>
    Object.fromEntries(
      methods.map((m) => [
        m,
        vi.fn(async () => {
          throw Object.assign(new Error(`connection terminated while reading ${EMAIL}`), { code: '57P01' })
        }),
      ]),
    )
  return { EMAIL, failing }
})
const EMAIL = h.EMAIL
const TOKEN = 'session-token-1234567890abcdef'

vi.mock('../repositories/AuthRepository.js', () => ({
  PostgresUserRepository: class {
    constructor() {
      Object.assign(
        this,
        h.failing(
          'getByEmail',
          'getById',
          'getOrCreateByEmail',
          'updateDisplayCurrency',
          'getByWalletAddress',
          'linkWalletToUser',
          'getLandlordProfile',
          'updateLandlordProfile',
          'updateName',
        ),
      )
    }
  },
  PostgresSessionRepository: class {
    constructor() {
      Object.assign(
        this,
        h.failing(
          'create',
          'getByToken',
          'getTokenState',
          'revokeByToken',
          'listActiveSessions',
          'revokeSession',
          'revokeAllSessions',
        ),
      )
    }
  },
  PostgresOtpChallengeRepository: class {
    constructor() {
      Object.assign(this, h.failing('set', 'getByEmail', 'deleteByEmail', 'updateAttempts'))
    }
  },
  PostgresWalletChallengeRepository: class {
    constructor() {
      Object.assign(
        this,
        h.failing('set', 'getByAddress', 'deleteByAddress', 'updateAttempts', 'markAsUsed'),
      )
    }
  },
}))

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import {
  getAuthStoreMode,
  userStore,
  sessionStore,
  otpChallengeStore,
  walletChallengeStore,
} from './authStore.js'
import { authenticateToken } from '../middleware/auth.js'

const ORIGINAL_MODE = process.env.AUTH_STORE

async function expect503(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to reject')
    },
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(AppError)
  expect((error as AppError).status).toBe(503)
  expect((error as AppError).code).toBe(ErrorCode.SERVICE_UNAVAILABLE)
  // The raw database message (which embedded the email) must not reach the client.
  expect((error as AppError).message).not.toContain(EMAIL)
}

describe('auth store backend selection', () => {
  it('honours an explicit AUTH_STORE', () => {
    expect(getAuthStoreMode({ AUTH_STORE: 'memory', DATABASE_URL: 'postgres://x' } as NodeJS.ProcessEnv)).toBe('memory')
    expect(getAuthStoreMode({ AUTH_STORE: 'postgres' } as NodeJS.ProcessEnv)).toBe('postgres')
    expect(getAuthStoreMode({ AUTH_STORE: ' MEMORY ' } as NodeJS.ProcessEnv)).toBe('memory')
  })

  it('uses Postgres when DATABASE_URL is set and in-memory when it is not', () => {
    expect(getAuthStoreMode({ DATABASE_URL: 'postgres://x' } as NodeJS.ProcessEnv)).toBe('postgres')
    expect(getAuthStoreMode({} as NodeJS.ProcessEnv)).toBe('memory')
  })

  it('ignores an unrecognised AUTH_STORE value', () => {
    expect(getAuthStoreMode({ AUTH_STORE: 'redis', DATABASE_URL: 'postgres://x' } as NodeJS.ProcessEnv)).toBe('postgres')
    expect(getAuthStoreMode({ AUTH_STORE: 'redis' } as NodeJS.ProcessEnv)).toBe('memory')
  })
})

describe('auth store with a failing Postgres', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AUTH_STORE = 'postgres'
  })

  afterEach(() => {
    process.env.AUTH_STORE = 'memory'
    userStore.clear()
    sessionStore.clear()
    otpChallengeStore.clear()
    walletChallengeStore.clear()
  })

  describe('users', () => {
    it('getByEmail / getById / getByWalletAddress surface 503', async () => {
      await expect503(userStore.getByEmail(EMAIL))
      await expect503(userStore.getById('user-1'))
      await expect503(userStore.getByWalletAddress('0xabc'))
    })

    it('getOrCreateByEmail (login) fails instead of creating a cached user', async () => {
      await expect503(userStore.getOrCreateByEmail(EMAIL))

      // Nothing was written to the in-memory copy.
      process.env.AUTH_STORE = 'memory'
      expect(await userStore.getByEmail(EMAIL)).toBeUndefined()
    })

    it('updates fail instead of editing a cached copy', async () => {
      await expect503(userStore.updateDisplayCurrency(EMAIL, 'USDC'))
      await expect503(userStore.linkWalletToUser(EMAIL, '0xabc'))
      await expect503(userStore.updateName('user-1', 'New Name'))
      await expect503(userStore.updateLandlordProfile('user-1', { phone: '1' }))
    })

    it('landlord profile lookup no longer hides the outage behind null', async () => {
      await expect503(userStore.getLandlordProfile('user-1'))
    })
  })

  describe('OTP challenges', () => {
    const challenge = { email: EMAIL, otpHash: 'h', salt: 's', expiresAt: new Date(Date.now() + 60_000), attempts: 0 }

    it('set fails and nothing is cached, so the OTP is not silently held in process memory', async () => {
      await expect503(otpChallengeStore.set(challenge))

      process.env.AUTH_STORE = 'memory'
      expect(await otpChallengeStore.getByEmail(EMAIL)).toBeUndefined()
    })

    it('lookup, delete and attempt updates all fail', async () => {
      await expect503(otpChallengeStore.getByEmail(EMAIL))
      await expect503(otpChallengeStore.deleteByEmail(EMAIL))
      await expect503(otpChallengeStore.updateAttempts(EMAIL, 2))
    })
  })

  describe('wallet challenges', () => {
    it('every operation fails and nothing is cached', async () => {
      await expect503(
        walletChallengeStore.set({
          address: '0xAbC',
          nonce: 'n',
          message: 'm',
          expiresAt: new Date(Date.now() + 60_000),
          attempts: 0,
        } as never),
      )
      await expect503(walletChallengeStore.getByAddress('0xabc'))
      await expect503(walletChallengeStore.deleteByAddress('0xabc'))
      await expect503(walletChallengeStore.updateAttempts('0xabc', 1))
      await expect503(walletChallengeStore.markAsUsed('0xabc'))

      process.env.AUTH_STORE = 'memory'
      expect(await walletChallengeStore.getByAddress('0xabc')).toBeUndefined()
    })
  })

  describe('sessions', () => {
    it('create fails and does not cache a session that was never stored', async () => {
      await expect503(sessionStore.create(EMAIL, TOKEN))

      process.env.AUTH_STORE = 'memory'
      expect(await sessionStore.getTokenState(TOKEN)).toBe('invalid')
      expect(await sessionStore.getByToken(TOKEN)).toBeUndefined()
    })

    it('token state and session lookup fail instead of answering from cache', async () => {
      await expect503(sessionStore.getTokenState(TOKEN))
      await expect503(sessionStore.getByToken(TOKEN))
    })

    it('a revocation that cannot reach Postgres is reported, never silently lost', async () => {
      await expect503(sessionStore.revokeByToken(TOKEN))
      await expect503(sessionStore.deleteByToken(TOKEN))
    })

    it('list and revoke operations fail', async () => {
      await expect503(sessionStore.listActiveSessions('user-1', EMAIL))
      await expect503(sessionStore.revokeSession('user-1', EMAIL, 'session-1'))
      await expect503(sessionStore.revokeAllSessions('user-1', EMAIL))
    })

    it('does not honour a session that exists only in the in-memory copy', async () => {
      // Create it in memory mode, then switch to Postgres: the copy must be ignored.
      process.env.AUTH_STORE = 'memory'
      await sessionStore.create(EMAIL, TOKEN)
      process.env.AUTH_STORE = 'postgres'

      await expect503(sessionStore.getTokenState(TOKEN))
    })

    it('the synchronous in-memory-only helper refuses to run against Postgres', () => {
      expect(() => sessionStore.getActiveSessionsByEmail(EMAIL)).toThrow(/in-memory/)
    })
  })

  describe('logging', () => {
    it('records the operation and error code, never emails, tokens or the raw message', async () => {
      await userStore.getByEmail(EMAIL).catch(() => {})
      await sessionStore.getTokenState(TOKEN).catch(() => {})

      expect(logger.error).toHaveBeenCalledTimes(2)
      for (const call of vi.mocked(logger.error).mock.calls) {
        const serialized = JSON.stringify(call)
        expect(serialized).not.toContain(EMAIL)
        expect(serialized).not.toContain(TOKEN)
        expect(serialized).not.toContain('connection terminated')
      }
      const [message, fields] = vi.mocked(logger.error).mock.calls[0] as [string, Record<string, unknown>]
      expect(message).toBe('Auth store database error')
      expect(fields).toMatchObject({ store: 'user', operation: 'getByEmail', errorCode: '57P01' })
    })

    it('does not use console', async () => {
      const spies = (['log', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
      await userStore.getByEmail(EMAIL).catch(() => {})
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
      }
    })
  })

  describe('domain errors', () => {
    it('passes a "User not found" error through instead of reporting an outage', async () => {
      const { PostgresUserRepository } = await import('../repositories/AuthRepository.js')
      void PostgresUserRepository
      // userStore's repo instance is private; exercise the classification through a stub.
      const repo = (userStore as unknown as { postgresRepo: { updateDisplayCurrency: ReturnType<typeof vi.fn> } })
        .postgresRepo
      repo.updateDisplayCurrency.mockRejectedValueOnce(new Error('User not found'))

      await expect(userStore.updateDisplayCurrency(EMAIL, 'USDC')).rejects.toThrow('User not found')
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe('request handling', () => {
    it('authentication returns the 503 instead of authenticating from cache', async () => {
      const next = vi.fn()
      const req = { headers: { authorization: `Bearer ${TOKEN}` }, get: vi.fn(), path: '/x' } as never

      await authenticateToken(req, {} as never, next)

      expect(next).toHaveBeenCalledTimes(1)
      const error = next.mock.calls[0]![0] as AppError
      expect(error).toBeInstanceOf(AppError)
      expect(error.status).toBe(503)
    })
  })
})

describe('auth store with the in-memory backend selected', () => {
  beforeEach(() => {
    process.env.AUTH_STORE = 'memory'
    userStore.clear()
    sessionStore.clear()
  })

  afterEach(() => {
    if (ORIGINAL_MODE === undefined) delete process.env.AUTH_STORE
    else process.env.AUTH_STORE = ORIGINAL_MODE
  })

  it('works without touching the Postgres repositories', async () => {
    const user = await userStore.getOrCreateByEmail(EMAIL)
    expect(user.email).toBe(EMAIL)
    expect((await userStore.getByEmail(EMAIL))?.id).toBe(user.id)

    const session = await sessionStore.create(EMAIL, TOKEN)
    expect(session.token).toBe(TOKEN)
    expect(await sessionStore.getTokenState(TOKEN)).toBe('active')

    await sessionStore.revokeByToken(TOKEN)
    expect(await sessionStore.getTokenState(TOKEN)).toBe('invalid')
  })

  it('revokeAllByEmail revokes only that email\'s sessions', async () => {
    await sessionStore.create(EMAIL, 'tok-a')
    await sessionStore.create(EMAIL, 'tok-b')
    await sessionStore.create('bob@example.com', 'tok-c')

    expect(await sessionStore.revokeAllByEmail(EMAIL)).toBe(2)
    expect(await sessionStore.getTokenState('tok-c')).toBe('active')
  })

  it('does not log errors when nothing fails', async () => {
    await userStore.getOrCreateByEmail(EMAIL)
    expect(logger.error).not.toHaveBeenCalled()
  })
})
