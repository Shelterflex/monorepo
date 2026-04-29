/**
 * Base class for all tenant-scoped repositories (#657).
 *
 * Enforces that every query carries an explicit tenantId. Subclasses call
 * `this.scopedQuery(tenantId, sql, params)` which prepends the tenant guard
 * and throws `UnscopedQueryError` if tenantId is absent.
 */

import { getPool } from '../db.js'
import { AppError } from '../errors/AppError.js'
import { logger } from '../utils/logger.js'

export class UnscopedQueryError extends AppError {
  constructor(operation: string) {
    super(
      'UNSCOPED_QUERY',
      500,
      `Tenant-scoped operation '${operation}' was called without a tenantId. This is a programming error.`,
    )
    this.name = 'UnscopedQueryError'
  }
}

export abstract class TenantScopedRepository {
  protected readonly tableName: string
  protected readonly tenantColumn: string

  constructor(tableName: string, tenantColumn = 'organization_id') {
    this.tableName = tableName
    this.tenantColumn = tenantColumn
  }

  private async pool() {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool unavailable')
    return pool
  }

  /**
   * Execute a SELECT that is guaranteed to include a tenant filter.
   * `sql` must contain a `$1` placeholder for tenantId; remaining params
   * start at `$2`.
   */
  protected async scopedQuery<T>(
    tenantId: string | undefined,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    this.guardTenantId(tenantId, 'scopedQuery')
    const pool = await this.pool()
    const { rows } = await pool.query(sql, [tenantId, ...params])
    return rows as T[]
  }

  /**
   * Execute a write (INSERT/UPDATE/DELETE) that is guaranteed to scope to the
   * given tenant. `sql` must place tenantId as `$1`.
   */
  protected async scopedWrite(
    tenantId: string | undefined,
    sql: string,
    params: unknown[] = [],
  ): Promise<number> {
    this.guardTenantId(tenantId, 'scopedWrite')
    const pool = await this.pool()
    const result = await pool.query(sql, [tenantId, ...params])
    return result.rowCount ?? 0
  }

  /**
   * Verify that a fetched row belongs to the requested tenant.
   * Throws and logs a security event if there is a mismatch.
   */
  protected assertRowTenant(
    row: Record<string, unknown>,
    requestedTenantId: string,
    resourceId: string,
  ): void {
    const rowTenant = row[this.tenantColumn] as string | undefined
    if (!rowTenant || rowTenant !== requestedTenantId) {
      logger.error('Cross-tenant row access blocked', {
        table: this.tableName,
        resourceId,
        requestedTenantId,
        rowTenantId: rowTenant,
      })
      throw new AppError(
        'CROSS_TENANT_ACCESS_DENIED',
        403,
        `Row ${resourceId} in ${this.tableName} does not belong to tenant ${requestedTenantId}.`,
      )
    }
  }

  private guardTenantId(tenantId: string | undefined, operation: string): void {
    if (!tenantId || tenantId.trim() === '') {
      throw new UnscopedQueryError(`${this.tableName}.${operation}`)
    }
  }
}
