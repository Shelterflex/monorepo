/**
 * Multi-tenant data partitioning — adversarial security test suite (#657).
 */

import { describe, it, expect } from 'vitest'
import { requireTenantContext, assertTenantMatch, UNSCOPED_TENANT, TenantRequest } from '../middleware/tenantContext.js'
import { UnscopedQueryError, TenantScopedRepository } from './TenantScopedRepository.js'
import { AppError } from '../errors/AppError.js'

// ── Stub helpers ─────────────────────────────────────────────────────────────

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    headers: {},
    ip: '127.0.0.1',
    path: '/test',
    requestId: 'req-123',
    user: { id: 'user-1', email: 'u@x.com', role: 'landlord', tenantId: 'org-A' },
    ...overrides,
  }
}

function runMiddleware(req: Record<string, unknown>): { tenantId?: string; error?: AppError } {
  let captured: AppError | undefined
  let called = false
  const next = (err?: unknown) => {
    if (err instanceof AppError) captured = err
    called = true
  }
  requireTenantContext(
    req as Parameters<typeof requireTenantContext>[0],
    {} as Parameters<typeof requireTenantContext>[1],
    next,
  )
  expect(called).toBe(true)
  return { tenantId: (req as TenantRequest).tenantId, error: captured }
}

// ── Concrete stub repo ────────────────────────────────────────────────────────

class StubRepo extends TenantScopedRepository {
  constructor() { super('test_table', 'organization_id') }

  async findForTenant(tenantId: string | undefined) {
    return this.scopedQuery(tenantId, 'SELECT * FROM test_table WHERE organization_id = $1', [])
  }

  checkRow(row: Record<string, unknown>, tenantId: string, id: string) {
    this.assertRowTenant(row, tenantId, id)
  }
}

// ── requireTenantContext ──────────────────────────────────────────────────────

describe('requireTenantContext middleware', () => {
  it('passes when tenantId is on user object', () => {
    const { tenantId, error } = runMiddleware(makeReq())
    expect(error).toBeUndefined()
    expect(tenantId).toBe('org-A')
  })

  it('passes when X-Tenant-ID header matches user tenant', () => {
    const { tenantId, error } = runMiddleware(makeReq({ headers: { 'x-tenant-id': 'org-A' } }))
    expect(error).toBeUndefined()
    expect(tenantId).toBe('org-A')
  })

  it('rejects request with no tenant context', () => {
    const req = makeReq({ user: { id: 'u', email: 'u@x.com', role: 'landlord' } })
    const { error } = runMiddleware(req)
    expect(error).toBeDefined()
    expect(error!.code).toBe('TENANT_CONTEXT_REQUIRED')
    expect(error!.status).toBe(403)
  })

  it('rejects UNSCOPED_TENANT sentinel value', () => {
    const req = makeReq({ user: { id: 'u', email: 'u@x.com', role: 'landlord', tenantId: UNSCOPED_TENANT } })
    const { error } = runMiddleware(req)
    expect(error?.code).toBe('TENANT_CONTEXT_REQUIRED')
  })

  it('[adversarial] blocks cross-tenant ID spoofing via X-Tenant-ID header', () => {
    const req = makeReq({ headers: { 'x-tenant-id': 'org-B' } })
    const { error } = runMiddleware(req)
    expect(error).toBeDefined()
    expect(error!.code).toBe('CROSS_TENANT_ACCESS_DENIED')
    expect(error!.status).toBe(403)
  })

  it('[adversarial] blocks empty-string tenant header', () => {
    const req = makeReq({
      headers: { 'x-tenant-id': '   ' },
      user: { id: 'u', email: 'u@x.com', role: 'landlord' },
    })
    const { error } = runMiddleware(req)
    expect(error?.code).toBe('TENANT_CONTEXT_REQUIRED')
  })
})

// ── assertTenantMatch ─────────────────────────────────────────────────────────

describe('assertTenantMatch', () => {
  it('passes when tenant IDs match', () => {
    expect(() =>
      assertTenantMatch('org-A', 'org-A', { resourceType: 'Deal', resourceId: 'deal-1' }),
    ).not.toThrow()
  })

  it('[adversarial] throws CROSS_TENANT_ACCESS_DENIED on mismatch', () => {
    expect(() =>
      assertTenantMatch('org-A', 'org-B', { resourceType: 'Property', resourceId: 'prop-9' }),
    ).toThrow(AppError)

    try {
      assertTenantMatch('org-A', 'org-B', { resourceType: 'Property', resourceId: 'prop-9' })
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe('CROSS_TENANT_ACCESS_DENIED')
    }
  })
})

// ── TenantScopedRepository ────────────────────────────────────────────────────

describe('TenantScopedRepository', () => {
  it('[adversarial] UnscopedQueryError when tenantId is undefined', async () => {
    const repo = new StubRepo()
    await expect(repo.findForTenant(undefined)).rejects.toBeInstanceOf(UnscopedQueryError)
  })

  it('[adversarial] UnscopedQueryError when tenantId is empty string', async () => {
    const repo = new StubRepo()
    await expect(repo.findForTenant('')).rejects.toBeInstanceOf(UnscopedQueryError)
  })

  it('[adversarial] assertRowTenant blocks cross-tenant row access', () => {
    const repo = new StubRepo()
    expect(() =>
      repo.checkRow({ organization_id: 'org-B', id: 'row-1' }, 'org-A', 'row-1'),
    ).toThrow(AppError)
  })

  it('[adversarial] assertRowTenant blocks row with missing organization_id', () => {
    const repo = new StubRepo()
    expect(() => repo.checkRow({ id: 'row-x' }, 'org-A', 'row-x')).toThrow(AppError)
  })

  it('[adversarial] pagination enumeration — unscoped queries are rejected', async () => {
    const repo = new StubRepo()
    for (const t of [undefined, ''] as const) {
      await expect(repo.findForTenant(t)).rejects.toBeInstanceOf(UnscopedQueryError)
    }
  })
})
