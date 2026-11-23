import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import type { Request } from 'express'

const mocks = vi.hoisted(() => ({
  getPool: vi.fn(),
  append: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('../db.js', () => ({ getPool: mocks.getPool }))
vi.mock('../repositories/AuditRepository.js', () => ({
  auditRepository: { append: mocks.append },
}))
vi.mock('./logger.js', () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import * as audit from './auditLogger.js'
import {
  auditLog,
  extractAuditContext,
  type AuditContext,
  type AuditEventType,
  type ActorType,
  type AuditLogEntry,
} from './auditLogger.js'

const FIXED_TIME = '2026-03-04T05:06:07.000Z'

function makeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    requestId: 'req-1',
    method: 'POST',
    path: '/api/thing',
    ip: '203.0.113.7',
    headers: {},
    user: { id: 'user-1' },
    ...overrides,
  } as unknown as Request
}

const CTX: AuditContext = {
  userId: 'user-1',
  requestId: 'req-1',
  ip: '203.0.113.7',
  actorType: 'user',
  httpMethod: 'POST',
  httpPath: '/api/thing',
}

let stdout: string[]

function lastEntry(): AuditLogEntry {
  expect(stdout.length).toBeGreaterThan(0)
  return JSON.parse(stdout[stdout.length - 1]) as AuditLogEntry
}

/** Lets the fire-and-forget persistence promise settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
}

describe('auditLogger', () => {
  beforeAll(async () => {
    // Warm the lazy import in persistToDatabase so its first use isn't slower than flush().
    await import('../repositories/AuditRepository.js')
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(FIXED_TIME))
    stdout = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk))
      return true
    })
    mocks.getPool.mockReset().mockResolvedValue(null)
    mocks.append.mockReset().mockResolvedValue({})
    mocks.warn.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('extractAuditContext', () => {
    it('builds a full context from an authenticated request', () => {
      expect(extractAuditContext(makeReq(), 'admin')).toEqual({
        userId: 'user-1',
        requestId: 'req-1',
        ip: '203.0.113.7',
        actorType: 'admin',
        httpMethod: 'POST',
        httpPath: '/api/thing',
      })
    })

    // [description, request overrides, expected userId]
    const userIdCases: Array<[string, Record<string, unknown>, string]> = [
      ['user.id', { user: { id: 'a' } }, 'a'],
      ['numeric user.id is stringified', { user: { id: 42 } }, '42'],
      ['user.userId', { user: { userId: 'b' } }, 'b'],
      ['user.sub', { user: { sub: 'c' } }, 'c'],
      ['user.id wins over userId and sub', { user: { id: 'a', userId: 'b', sub: 'c' } }, 'a'],
      ['req.userId when no user object', { user: undefined, userId: 'd' }, 'd'],
      ['non-object user falls through to req.userId', { user: 'x', userId: 'd' }, 'd'],
      ['empty user object → anonymous', { user: {} }, 'anonymous'],
      ['no principal → anonymous', { user: undefined }, 'anonymous'],
    ]

    it.each(userIdCases)('userId from %s', (_label, overrides, expected) => {
      expect(extractAuditContext(makeReq(overrides), 'user').userId).toBe(expected)
    })

    it('does not trust a spoofed x-user-id header', () => {
      const req = makeReq({ user: undefined, headers: { 'x-user-id': 'attacker' } })
      expect(extractAuditContext(req, 'user').userId).toBe('anonymous')
    })

    it('uses req.ip and ignores forgeable forwarding headers', () => {
      const req = makeReq({
        ip: '198.51.100.1',
        headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7', 'x-real-ip': '8.8.8.8' },
      })
      expect(extractAuditContext(req, 'user').ip).toBe('198.51.100.1')
    })

    it('falls back to "unknown" for a missing ip and requestId', () => {
      const ctx = extractAuditContext(makeReq({ ip: undefined, requestId: undefined }), 'system')
      expect(ctx.ip).toBe('unknown')
      expect(ctx.requestId).toBe('unknown')
      expect(ctx.actorType).toBe('system')
    })
  })

  describe('auditLog — stdout entry', () => {
    it('writes one newline-terminated JSON line with every field', () => {
      auditLog('DEAL_CREATED', CTX, { dealId: 'd1' })
      expect(stdout).toHaveLength(1)
      expect(stdout[0].endsWith('\n')).toBe(true)
      expect(lastEntry()).toEqual({
        eventType: 'DEAL_CREATED',
        userId: 'user-1',
        requestId: 'req-1',
        ip: '203.0.113.7',
        actorType: 'user',
        timestamp: FIXED_TIME,
        metadata: { dealId: 'd1' },
        httpMethod: 'POST',
        httpPath: '/api/thing',
      })
    })

    it('defaults metadata to an empty object', () => {
      auditLog('AUTH_LOGOUT', CTX)
      expect(lastEntry().metadata).toEqual({})
    })

    it('redacts PII, tokens and secrets in nested metadata', () => {
      auditLog('AUTH_LOGIN_SUCCESS', CTX, {
        email: 'ada@example.com',
        phone: '+2348012345678',
        session: { accessToken: 'at_live', refresh_token: 'rt_live', device: 'ios' },
        attempts: [{ otp: '123456', ok: false }],
        password: 'hunter2',
      })
      const line = stdout[0]
      for (const secret of ['ada@example.com', '+2348012345678', 'at_live', 'rt_live', '123456', 'hunter2']) {
        expect(line).not.toContain(secret)
      }
      expect(lastEntry().metadata).toEqual({
        email: '[REDACTED]',
        phone: '[REDACTED]',
        session: { accessToken: '[REDACTED]', refresh_token: '[REDACTED]', device: 'ios' },
        attempts: [{ otp: '[REDACTED]', ok: false }],
        password: '[REDACTED]',
      })
    })

    it('does not mutate the caller’s metadata or context', () => {
      const metadata = Object.freeze({ email: 'a@b.com', nested: Object.freeze({ token: 't' }) })
      const ctx = Object.freeze({ ...CTX })
      expect(() => auditLog('AUTH_OTP_REQUESTED', ctx, metadata)).not.toThrow()
      expect(metadata).toEqual({ email: 'a@b.com', nested: { token: 't' } })
      expect(ctx).toEqual(CTX)
    })
  })

  describe('auditLog — database persistence (best-effort)', () => {
    it('skips persistence when no database is configured', async () => {
      auditLog('DEAL_CREATED', CTX)
      await flush()
      expect(mocks.getPool).toHaveBeenCalledTimes(1)
      expect(mocks.append).not.toHaveBeenCalled()
      expect(mocks.warn).not.toHaveBeenCalled()
    })

    it('appends the redacted entry when a pool exists', async () => {
      mocks.getPool.mockResolvedValue({})
      auditLog('DEAL_CREATED', CTX, { dealId: 'd1', email: 'a@b.com' })
      await vi.waitFor(() => expect(mocks.append).toHaveBeenCalled())
      expect(mocks.append).toHaveBeenCalledWith({
        eventType: 'DEAL_CREATED',
        actorType: 'user',
        userId: 'user-1',
        requestId: 'req-1',
        ipAddress: '203.0.113.7',
        httpMethod: 'POST',
        httpPath: '/api/thing',
        metadata: { dealId: 'd1', email: '[REDACTED]' },
        createdAt: new Date(FIXED_TIME),
      })
    })

    it('stores placeholder context values as null', async () => {
      mocks.getPool.mockResolvedValue({})
      auditLog('AUTH_LOGIN_FAILED', {
        userId: 'anonymous',
        requestId: 'unknown',
        ip: 'unknown',
        actorType: 'user',
      })
      await vi.waitFor(() => expect(mocks.append).toHaveBeenCalled())
      expect(mocks.append).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          requestId: null,
          ipAddress: null,
          httpMethod: null,
          httpPath: null,
        }),
      )
    })

    it('returns synchronously and swallows persistence errors with a warning', async () => {
      mocks.getPool.mockResolvedValue({})
      mocks.append.mockRejectedValue(new Error('db down'))
      expect(auditLog('DEAL_CREATED', CTX)).toBeUndefined()
      await vi.waitFor(() => expect(mocks.warn).toHaveBeenCalled())
      expect(mocks.warn).toHaveBeenCalledWith('Failed to persist audit entry to database', {
        eventType: 'DEAL_CREATED',
        error: 'db down',
      })
    })

    it('stringifies non-Error rejections in the warning', async () => {
      mocks.getPool.mockRejectedValue('boom')
      auditLog('DEAL_CREATED', CTX)
      await vi.waitFor(() => expect(mocks.warn).toHaveBeenCalled())
      expect(mocks.warn).toHaveBeenCalledWith(
        'Failed to persist audit entry to database',
        expect.objectContaining({ error: 'boom' }),
      )
    })
  })

  describe('auditLog — durable mode', () => {
    it('resolves after the append completes', async () => {
      mocks.getPool.mockResolvedValue({})
      await expect(auditLog('USER_ERASURE_REQUESTED', CTX, {}, { durable: true })).resolves.toBeUndefined()
      expect(mocks.append).toHaveBeenCalledTimes(1)
    })

    it('rejects when no database is configured', async () => {
      await expect(auditLog('USER_ERASURE_REQUESTED', CTX, {}, { durable: true })).rejects.toThrow(
        'Audit database is not configured',
      )
      // stdout write still happened before the rejection.
      expect(lastEntry().eventType).toBe('USER_ERASURE_REQUESTED')
    })

    it('propagates append failures (and still logs a warning)', async () => {
      mocks.getPool.mockResolvedValue({})
      mocks.append.mockRejectedValue(new Error('constraint violation'))
      await expect(auditLog('USER_ERASURE_REQUESTED', CTX, {}, { durable: true })).rejects.toThrow(
        'constraint violation',
      )
      expect(mocks.warn).toHaveBeenCalledTimes(1)
    })
  })

  describe('convenience helpers emit the right event and actor', () => {
    type Helper = (req: Request, metadata?: never) => void
    // [helper name, expected eventType, expected actorType]
    const table: Array<[keyof typeof audit, AuditEventType, ActorType]> = [
      ['auditWalletCreated', 'WALLET_CREATED', 'user'],
      ['auditWalletSigningUsed', 'WALLET_SIGNING_USED', 'user'],
      ['auditWalletExportAttempt', 'WALLET_EXPORT_ATTEMPT', 'user'],
      ['auditAdminWalletAction', 'ADMIN_WALLET_ACTION', 'admin'],
      ['auditAuthOtpRequested', 'AUTH_OTP_REQUESTED', 'user'],
      ['auditAuthLoginSuccess', 'AUTH_LOGIN_SUCCESS', 'user'],
      ['auditAuthSessionRevoked', 'AUTH_SESSION_REVOKED', 'user'],
      ['auditAuthLoginFailed', 'AUTH_LOGIN_FAILED', 'user'],
      ['auditAuthLogout', 'AUTH_LOGOUT', 'user'],
      ['auditAuthLogoutAll', 'AUTH_LOGOUT_ALL', 'user'],
      ['auditAuthWalletChallengeIssued', 'AUTH_WALLET_CHALLENGE_ISSUED', 'user'],
      ['auditAuthWalletLoginSuccess', 'AUTH_WALLET_LOGIN_SUCCESS', 'user'],
      ['auditAuthWalletLoginFailed', 'AUTH_WALLET_LOGIN_FAILED', 'user'],
      ['auditListingApproved', 'LISTING_APPROVED', 'admin'],
      ['auditListingRejected', 'LISTING_REJECTED', 'admin'],
      ['auditRewardMarkedPaid', 'REWARD_MARKED_PAID', 'admin'],
      ['auditAdminOutboxMarkDead', 'ADMIN_OUTBOX_MARK_DEAD', 'admin'],
      ['auditAdminOutboxRetry', 'ADMIN_OUTBOX_RETRY', 'admin'],
    ]

    it('covers every exported audit* helper', () => {
      const exported = Object.keys(audit)
        .filter((k) => k.startsWith('audit') && k !== 'auditLog' && k !== 'auditAdminRiskOperation')
        .sort()
      expect(exported).toEqual(table.map(([name]) => name).sort())
    })

    it.each(table)('%s → %s as %s', (name, eventType, actorType) => {
      const helper = audit[name] as unknown as Helper
      helper(makeReq())
      const entry = lastEntry()
      expect(entry.eventType).toBe(eventType)
      expect(entry.actorType).toBe(actorType)
      expect(entry.userId).toBe('user-1')
      expect(entry.metadata).toEqual({})
    })

    it.each(table)('%s forwards and redacts metadata', (name) => {
      const helper = audit[name] as unknown as (req: Request, m: Record<string, unknown>) => void
      helper(makeReq(), { ref: 'r1', email: 'a@b.com' })
      expect(lastEntry().metadata).toEqual({ ref: 'r1', email: '[REDACTED]' })
    })

    it.each(['ADMIN_RISK_FREEZE', 'ADMIN_RISK_UNFREEZE'] as const)(
      'auditAdminRiskOperation → %s as admin',
      (eventType) => {
        audit.auditAdminRiskOperation(makeReq(), eventType, { accountId: 'acc-1' })
        const entry = lastEntry()
        expect(entry.eventType).toBe(eventType)
        expect(entry.actorType).toBe('admin')
        expect(entry.metadata).toEqual({ accountId: 'acc-1' })
      },
    )

    it('auditAdminRiskOperation defaults metadata to {}', () => {
      audit.auditAdminRiskOperation(makeReq(), 'ADMIN_RISK_FREEZE')
      expect(lastEntry().metadata).toEqual({})
    })

    it('records an anonymous principal for unauthenticated helper calls', () => {
      audit.auditAuthLoginFailed(makeReq({ user: undefined }), { reason: 'bad otp' })
      const entry = lastEntry()
      expect(entry.userId).toBe('anonymous')
      expect(entry.metadata).toEqual({ reason: 'bad otp' })
    })
  })
})
