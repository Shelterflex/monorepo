import { getPool } from '../db.js'
import {
  type FraudSignal,
  type CreateSignalInput,
  type FraudAssessment,
  type AccountHold,
  SignalType,
  RiskLevel,
  ActionType,
  EntityType,
} from './types.js'

export interface FraudStore {
  // Signal management
  createSignal(input: CreateSignalInput): Promise<FraudSignal>
  getSignal(id: string): Promise<FraudSignal | null>
  listSignals(filters?: { enabled?: boolean }): Promise<FraudSignal[]>
  updateSignal(id: string, updates: Partial<CreateSignalInput>): Promise<FraudSignal>
  deleteSignal(id: string): Promise<void>
  enableSignal(id: string): Promise<void>
  disableSignal(id: string): Promise<void>

  // Assessment management
  createAssessment(
    entityType: EntityType,
    entityId: string,
    totalScore: number,
    riskLevel: RiskLevel,
    actionTaken: ActionType | null,
    signalMatches: unknown[],
    context: Record<string, unknown>,
  ): Promise<FraudAssessment>
  getAssessment(id: string): Promise<FraudAssessment | null>
  getAssessmentsByEntity(entityType: EntityType, entityId: string, limit?: number): Promise<FraudAssessment[]>
  listAssessments(filters?: { riskLevel?: RiskLevel; limit?: number; offset?: number }): Promise<FraudAssessment[]>

  // Account holds
  createAccountHold(accountId: string, assessmentId: string, holdType: string, holdReason: string): Promise<AccountHold>
  getActiveHolds(accountId: string): Promise<AccountHold[]>
  releaseHold(holdId: string, releasedBy: string): Promise<void>
}

// ---------------------------------------------------------------------------
// In-memory implementation (used in tests / no DATABASE_URL)
// ---------------------------------------------------------------------------

export class InMemoryFraudStore implements FraudStore {
  private signals = new Map<string, FraudSignal>()
  private assessments = new Map<string, FraudAssessment>()
  private holds = new Map<string, AccountHold>()

  async createSignal(input: CreateSignalInput): Promise<FraudSignal> {
    const signal: FraudSignal = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description ?? null,
      signalType: input.signalType,
      config: input.config,
      enabled: input.enabled ?? true,
      scoreWeight: input.scoreWeight ?? 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.signals.set(signal.id, signal)
    return { ...signal }
  }

  async getSignal(id: string): Promise<FraudSignal | null> {
    const signal = this.signals.get(id)
    return signal ? { ...signal } : null
  }

  async listSignals(filters?: { enabled?: boolean }): Promise<FraudSignal[]> {
    let results = Array.from(this.signals.values())
    if (filters?.enabled !== undefined) {
      results = results.filter(s => s.enabled === filters.enabled)
    }
    return results.map(s => ({ ...s }))
  }

  async updateSignal(id: string, updates: Partial<CreateSignalInput>): Promise<FraudSignal> {
    const signal = this.signals.get(id)
    if (!signal) throw new Error(`Signal ${id} not found`)

    if (updates.name !== undefined) signal.name = updates.name
    if (updates.description !== undefined) signal.description = updates.description
    if (updates.signalType !== undefined) signal.signalType = updates.signalType
    if (updates.config !== undefined) signal.config = updates.config
    if (updates.enabled !== undefined) signal.enabled = updates.enabled
    if (updates.scoreWeight !== undefined) signal.scoreWeight = updates.scoreWeight
    signal.updatedAt = new Date()

    return { ...signal }
  }

  async deleteSignal(id: string): Promise<void> {
    this.signals.delete(id)
  }

  async enableSignal(id: string): Promise<void> {
    const signal = this.signals.get(id)
    if (signal) {
      signal.enabled = true
      signal.updatedAt = new Date()
    }
  }

  async disableSignal(id: string): Promise<void> {
    const signal = this.signals.get(id)
    if (signal) {
      signal.enabled = false
      signal.updatedAt = new Date()
    }
  }

  async createAssessment(
    entityType: EntityType,
    entityId: string,
    totalScore: number,
    riskLevel: RiskLevel,
    actionTaken: ActionType | null,
    signalMatches: unknown[],
    context: Record<string, unknown>,
  ): Promise<FraudAssessment> {
    const assessment: FraudAssessment = {
      id: crypto.randomUUID(),
      entityType,
      entityId,
      totalScore,
      riskLevel,
      actionTaken,
      signalMatches: signalMatches as any,
      context,
      assessedAt: new Date(),
      createdAt: new Date(),
    }
    this.assessments.set(assessment.id, assessment)
    return { ...assessment }
  }

  async getAssessment(id: string): Promise<FraudAssessment | null> {
    const assessment = this.assessments.get(id)
    return assessment ? { ...assessment } : null
  }

  async getAssessmentsByEntity(entityType: EntityType, entityId: string, limit: number = 50): Promise<FraudAssessment[]> {
    const results = Array.from(this.assessments.values())
      .filter(a => a.entityType === entityType && a.entityId === entityId)
      .sort((a, b) => b.assessedAt.getTime() - a.assessedAt.getTime())
      .slice(0, limit)
    return results.map(a => ({ ...a }))
  }

  async listAssessments(filters?: { riskLevel?: RiskLevel; limit?: number; offset?: number }): Promise<FraudAssessment[]> {
    let results = Array.from(this.assessments.values())
    if (filters?.riskLevel) {
      results = results.filter(a => a.riskLevel === filters.riskLevel)
    }
    const offset = filters?.offset ?? 0
    const limit = filters?.limit ?? 50
    return results
      .sort((a, b) => b.assessedAt.getTime() - a.assessedAt.getTime())
      .slice(offset, offset + limit)
      .map(a => ({ ...a }))
  }

  async createAccountHold(accountId: string, assessmentId: string, holdType: string, holdReason: string): Promise<AccountHold> {
    const hold: AccountHold = {
      id: crypto.randomUUID(),
      accountId,
      assessmentId,
      holdType: holdType as any,
      holdReason,
      releasedAt: null,
      releasedBy: null,
      createdAt: new Date(),
    }
    this.holds.set(hold.id, hold)
    return { ...hold }
  }

  async getActiveHolds(accountId: string): Promise<AccountHold[]> {
    return Array.from(this.holds.values())
      .filter(h => h.accountId === accountId && h.releasedAt === null)
      .map(h => ({ ...h }))
  }

  async releaseHold(holdId: string, releasedBy: string): Promise<void> {
    const hold = this.holds.get(holdId)
    if (hold) {
      hold.releasedAt = new Date()
      hold.releasedBy = releasedBy
    }
  }
}

// ---------------------------------------------------------------------------
// Postgres implementation
// ---------------------------------------------------------------------------

function rowToSignal(row: Record<string, unknown>): FraudSignal {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    signalType: row.signal_type as SignalType,
    config: (row.config as Record<string, unknown>) ?? {},
    enabled: row.enabled as boolean,
    scoreWeight: row.score_weight as number,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

function rowToAssessment(row: Record<string, unknown>): FraudAssessment {
  return {
    id: row.id as string,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id as string,
    totalScore: row.total_score as number,
    riskLevel: row.risk_level as RiskLevel,
    actionTaken: (row.action_taken as ActionType | null) ?? null,
    signalMatches: (row.signal_matches as any[]) ?? [],
    context: (row.context as Record<string, unknown>) ?? {},
    assessedAt: new Date(row.assessed_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

function rowToHold(row: Record<string, unknown>): AccountHold {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    assessmentId: row.assessment_id as string,
    holdType: row.hold_type as any,
    holdReason: row.hold_reason as string,
    releasedAt: row.released_at ? new Date(row.released_at as string) : null,
    releasedBy: (row.released_by as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
  }
}

export class PostgresFraudStore implements FraudStore {
  async createSignal(input: CreateSignalInput): Promise<FraudSignal> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `INSERT INTO fraud_signals (name, description, signal_type, config, enabled, score_weight)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.name,
        input.description ?? null,
        input.signalType,
        JSON.stringify(input.config),
        input.enabled ?? true,
        input.scoreWeight ?? 10,
      ],
    )
    return rowToSignal(result.rows[0])
  }

  async getSignal(id: string): Promise<FraudSignal | null> {
    const pool = await getPool()
    if (!pool) return null

    const result = await pool.query('SELECT * FROM fraud_signals WHERE id = $1', [id])
    return result.rows[0] ? rowToSignal(result.rows[0]) : null
  }

  async listSignals(filters?: { enabled?: boolean }): Promise<FraudSignal[]> {
    const pool = await getPool()
    if (!pool) return []

    let query = 'SELECT * FROM fraud_signals'
    const params: unknown[] = []

    if (filters?.enabled !== undefined) {
      query += ' WHERE enabled = $1'
      params.push(filters.enabled)
    }

    query += ' ORDER BY created_at DESC'

    const result = await pool.query(query, params)
    return result.rows.map(rowToSignal)
  }

  async updateSignal(id: string, updates: Partial<CreateSignalInput>): Promise<FraudSignal> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const fields: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex++}`)
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`)
      values.push(updates.description)
    }
    if (updates.signalType !== undefined) {
      fields.push(`signal_type = $${paramIndex++}`)
      values.push(updates.signalType)
    }
    if (updates.config !== undefined) {
      fields.push(`config = $${paramIndex++}`)
      values.push(JSON.stringify(updates.config))
    }
    if (updates.enabled !== undefined) {
      fields.push(`enabled = $${paramIndex++}`)
      values.push(updates.enabled)
    }
    if (updates.scoreWeight !== undefined) {
      fields.push(`score_weight = $${paramIndex++}`)
      values.push(updates.scoreWeight)
    }

    fields.push(`updated_at = NOW()`)
    values.push(id)

    const result = await pool.query(
      `UPDATE fraud_signals SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values,
    )
    return rowToSignal(result.rows[0])
  }

  async deleteSignal(id: string): Promise<void> {
    const pool = await getPool()
    if (!pool) return

    await pool.query('DELETE FROM fraud_signals WHERE id = $1', [id])
  }

  async enableSignal(id: string): Promise<void> {
    const pool = await getPool()
    if (!pool) return

    await pool.query(
      'UPDATE fraud_signals SET enabled = true, updated_at = NOW() WHERE id = $1',
      [id],
    )
  }

  async disableSignal(id: string): Promise<void> {
    const pool = await getPool()
    if (!pool) return

    await pool.query(
      'UPDATE fraud_signals SET enabled = false, updated_at = NOW() WHERE id = $1',
      [id],
    )
  }

  async createAssessment(
    entityType: EntityType,
    entityId: string,
    totalScore: number,
    riskLevel: RiskLevel,
    actionTaken: ActionType | null,
    signalMatches: unknown[],
    context: Record<string, unknown>,
  ): Promise<FraudAssessment> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `INSERT INTO fraud_assessments (entity_type, entity_id, total_score, risk_level, action_taken, signal_matches, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [entityType, entityId, totalScore, riskLevel, actionTaken, JSON.stringify(signalMatches), JSON.stringify(context)],
    )
    return rowToAssessment(result.rows[0])
  }

  async getAssessment(id: string): Promise<FraudAssessment | null> {
    const pool = await getPool()
    if (!pool) return null

    const result = await pool.query('SELECT * FROM fraud_assessments WHERE id = $1', [id])
    return result.rows[0] ? rowToAssessment(result.rows[0]) : null
  }

  async getAssessmentsByEntity(entityType: EntityType, entityId: string, limit: number = 50): Promise<FraudAssessment[]> {
    const pool = await getPool()
    if (!pool) return []

    const result = await pool.query(
      `SELECT * FROM fraud_assessments
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY assessed_at DESC
       LIMIT $3`,
      [entityType, entityId, limit],
    )
    return result.rows.map(rowToAssessment)
  }

  async listAssessments(filters?: { riskLevel?: RiskLevel; limit?: number; offset?: number }): Promise<FraudAssessment[]> {
    const pool = await getPool()
    if (!pool) return []

    const params: unknown[] = []
    let where = ''

    if (filters?.riskLevel) {
      params.push(filters.riskLevel)
      where = `WHERE risk_level = $${params.length}`
    }

    params.push(filters?.limit ?? 50)
    params.push(filters?.offset ?? 0)

    const result = await pool.query(
      `SELECT * FROM fraud_assessments ${where}
       ORDER BY assessed_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    return result.rows.map(rowToAssessment)
  }

  async createAccountHold(accountId: string, assessmentId: string, holdType: string, holdReason: string): Promise<AccountHold> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `INSERT INTO fraud_account_holds (account_id, assessment_id, hold_type, hold_reason)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [accountId, assessmentId, holdType, holdReason],
    )
    return rowToHold(result.rows[0])
  }

  async getActiveHolds(accountId: string): Promise<AccountHold[]> {
    const pool = await getPool()
    if (!pool) return []

    const result = await pool.query(
      `SELECT * FROM fraud_account_holds
       WHERE account_id = $1 AND released_at IS NULL
       ORDER BY created_at DESC`,
      [accountId],
    )
    return result.rows.map(rowToHold)
  }

  async releaseHold(holdId: string, releasedBy: string): Promise<void> {
    const pool = await getPool()
    if (!pool) return

    await pool.query(
      `UPDATE fraud_account_holds
       SET released_at = NOW(), released_by = $1
       WHERE id = $2`,
      [releasedBy, holdId],
    )
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let store: FraudStore = new InMemoryFraudStore()

export function initFraudStore(newStore: FraudStore): void {
  store = newStore
}

export function getFraudStore(): FraudStore {
  return store
}
