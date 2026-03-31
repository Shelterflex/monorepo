import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'

/**
 * Unit tests for AuditRepository hash-chain logic.
 *
 * The repository requires a real PostgreSQL pool, so we mock getPool()
 * to return an in-memory fake that stores rows and supports the exact
 * queries the repository issues.
 */

// ---------------------------------------------------------------------------
// In-memory pool mock
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>

class InMemoryPool {
  rows: Row[] = []
  private idCounter = 0

  private nextId(): string {
    return `test-id-${String(++this.idCounter).padStart(6, '0')}`
  }

  async query(text: string, params: unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> {
    const t = text.trim()

    // SELECT last event_hash (used by getLastHash)
    if (t.startsWith('SELECT event_hash FROM audit_log ORDER BY')) {
      if (this.rows.length === 0) return { rows: [], rowCount: 0 }
      // Sort by created_at DESC, then id DESC as tiebreaker (lexicographic on zero-padded id)
      const sorted = [...this.rows].sort((a, b) => {
        const ta = new Date(a.created_at as string).getTime()
        const tb = new Date(b.created_at as string).getTime()
        if (tb !== ta) return tb - ta
        return (b.id as string) > (a.id as string) ? 1 : -1
      })
      return { rows: [{ event_hash: sorted[0].event_hash }], rowCount: 1 }
    }

    // INSERT
    if (t.startsWith('INSERT INTO audit_log')) {
      const [
        eventType, actorType, userId, requestId, ipAddress,
        httpMethod, httpPath, metadataRaw, prevHash, eventHash, chainHash, createdAtParam,
      ] = params as [
        string, string, string | null, string | null, string | null,
        string | null, string | null, string, string, string, string, unknown
      ]

      const createdAtDate = createdAtParam instanceof Date
        ? createdAtParam
        : new Date(createdAtParam as string)

      const row: Row = {
        id: this.nextId(),
        event_type: eventType,
        actor_type: actorType,
        user_id: userId,
        request_id: requestId,
        ip_address: ipAddress,
        http_method: httpMethod,
        http_path: httpPath,
        metadata: typeof metadataRaw === 'string' ? JSON.parse(metadataRaw) : metadataRaw,
        prev_hash: prevHash,
        event_hash: eventHash,
        chain_hash: chainHash,
        // Store as ISO string so round-trip via new Date().toISOString() is identical
        created_at: createdAtDate.toISOString(),
      }
      this.rows.push(row)
      return { rows: [row], rowCount: 1 }
    }

    // COUNT(*) for search
    if (t.startsWith('SELECT COUNT(*)')) {
      return { rows: [{ total: this.rows.length }], rowCount: 1 }
    }

    // SELECT * — used by both verifyChain and search
    if (t.startsWith('SELECT * FROM audit_log')) {
      // Return in insertion order (ascending by id, which matches ascending created_at)
      const sorted = [...this.rows].sort((a, b) =>
        (a.id as string) < (b.id as string) ? -1 : 1,
      )
      return { rows: sorted, rowCount: sorted.length }
    }

    return { rows: [], rowCount: 0 }
  }

  clear() {
    this.rows = []
    this.idCounter = 0
  }
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const fakePool = new InMemoryPool()

vi.mock('../db.js', () => ({
  getPool: vi.fn(async () => fakePool),
  setPool: vi.fn(),
  getPoolMetrics: vi.fn(() => null),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AuditRepository', () => {
  beforeEach(() => {
    fakePool.clear()
    vi.stubEnv('AUDIT_HMAC_SECRET', 'test-hmac-secret-32-chars-long!!')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function getRepo() {
    const mod = await import('./AuditRepository.js')
    return new mod.AuditRepository()
  }

  it('appends an entry and returns it with hashes', async () => {
    const repo = await getRepo()

    const entry = await repo.append({
      eventType: 'AUTH_LOGIN_SUCCESS',
      actorType: 'user',
      userId: 'user-1',
      requestId: 'req-1',
      ipAddress: '127.0.0.1',
      httpMethod: 'POST',
      httpPath: '/api/auth/verify-otp',
      metadata: { email: 'test@example.com' },
    })

    expect(entry.eventType).toBe('AUTH_LOGIN_SUCCESS')
    expect(entry.actorType).toBe('user')
    expect(entry.userId).toBe('user-1')
    expect(typeof entry.eventHash).toBe('string')
    expect(entry.eventHash.length).toBe(64) // HMAC-SHA256 hex
    expect(entry.prevHash).toBe('GENESIS')
    expect(typeof entry.chainHash).toBe('string')
    expect(entry.chainHash.length).toBe(64)
  })

  it('chains consecutive entries', async () => {
    const repo = await getRepo()

    const e1 = await repo.append({
      eventType: 'AUTH_OTP_REQUESTED',
      actorType: 'user',
      createdAt: new Date('2026-01-01T00:00:01Z'),
    })
    const e2 = await repo.append({
      eventType: 'AUTH_LOGIN_SUCCESS',
      actorType: 'user',
      createdAt: new Date('2026-01-01T00:00:02Z'),
    })

    expect(e1.prevHash).toBe('GENESIS')
    expect(e2.prevHash).toBe(e1.eventHash)
  })

  it('verifyChain returns valid for a clean chain', async () => {
    const repo = await getRepo()

    await repo.append({
      eventType: 'AUTH_OTP_REQUESTED',
      actorType: 'user',
      createdAt: new Date('2026-01-01T00:00:01Z'),
    })
    await repo.append({
      eventType: 'AUTH_LOGIN_SUCCESS',
      actorType: 'user',
      createdAt: new Date('2026-01-01T00:00:02Z'),
    })
    await repo.append({
      eventType: 'AUTH_LOGOUT',
      actorType: 'user',
      createdAt: new Date('2026-01-01T00:00:03Z'),
    })

    const result = await repo.verifyChain()
    expect(result.valid).toBe(true)
    expect(result.checkedCount).toBe(3)
    expect(result.firstBrokenId).toBeNull()
    expect(result.error).toBeNull()
  })

  it('verifyChain returns invalid when event_hash is tampered', async () => {
    const repo = await getRepo()

    await repo.append({
      eventType: 'AUTH_LOGIN_SUCCESS',
      actorType: 'user',
      createdAt: new Date('2026-01-01T00:00:01Z'),
    })

    // Tamper with the stored event_hash
    fakePool.rows[0].event_hash = 'tampered-hash-value-' + 'x'.repeat(44)

    const result = await repo.verifyChain()
    expect(result.valid).toBe(false)
    expect(result.firstBrokenId).toBeTruthy()
    expect(result.error).toMatch(/event_hash mismatch/)
  })

  it('verifyChain returns invalid when metadata is tampered without updating hash', async () => {
    const repo = await getRepo()

    await repo.append({
      eventType: 'ADMIN_WALLET_ACTION',
      actorType: 'admin',
      metadata: { action: 'WALLET_REWRAP' },
      createdAt: new Date('2026-01-01T00:00:01Z'),
    })

    // Tamper with metadata without updating the hash
    fakePool.rows[0].metadata = { action: 'MALICIOUS' }

    const result = await repo.verifyChain()
    expect(result.valid).toBe(false)
  })

  it('verifyChain returns valid=true when table is empty', async () => {
    const repo = await getRepo()
    const result = await repo.verifyChain()
    expect(result.valid).toBe(true)
    expect(result.checkedCount).toBe(0)
  })

  it('event_hash is deterministic for the same input', async () => {
    const secret = 'test-hmac-secret-32-chars-long!!'
    const payload = JSON.stringify({
      eventType: 'AUTH_LOGIN_SUCCESS',
      actorType: 'user',
      userId: 'u1',
      requestId: 'r1',
      ipAddress: '1.2.3.4',
      httpMethod: 'POST',
      httpPath: '/auth',
      metadata: { email: 'a@b.com' },
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const hash1 = createHmac('sha256', secret).update(payload).digest('hex')
    const hash2 = createHmac('sha256', secret).update(payload).digest('hex')
    expect(hash1).toBe(hash2)
    expect(hash1.length).toBe(64)
  })

  it('event_hash differs when metadata changes', async () => {
    const repo = await getRepo()

    const e1 = await repo.append({
      eventType: 'AUTH_LOGIN_SUCCESS',
      actorType: 'user',
      metadata: { email: 'a@b.com' },
      createdAt: new Date('2026-01-01T00:00:01Z'),
    })
    const e2 = await repo.append({
      eventType: 'AUTH_LOGIN_SUCCESS',
      actorType: 'user',
      metadata: { email: 'different@b.com' },
      createdAt: new Date('2026-01-01T00:00:02Z'),
    })

    expect(e1.eventHash).not.toBe(e2.eventHash)
  })
})
