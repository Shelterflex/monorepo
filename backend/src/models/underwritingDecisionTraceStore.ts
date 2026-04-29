/**
 * Underwriting Decision Trace Store
 * In-memory and PostgreSQL implementations for decision trace persistence
 */

import { getPool } from '../db.js'
import {
  UnderwritingDecisionTrace,
  CreateUnderwritingDecisionTraceInput,
  UnderwritingDecisionTraceStore,
} from './underwritingDecisionTrace.js'
import { UnderwritingDecision } from '../services/underwritingRuleEngine.js'

/**
 * In-memory implementation for testing
 */
export class InMemoryUnderwritingDecisionTraceStore implements UnderwritingDecisionTraceStore {
  private traces: Map<string, UnderwritingDecisionTrace> = new Map()
  private counter = 1

  async create(input: CreateUnderwritingDecisionTraceInput): Promise<UnderwritingDecisionTrace> {
    const id = `TRACE-${Date.now()}-${this.counter++}`
    const trace: UnderwritingDecisionTrace = {
      id,
      ...input,
      createdAt: new Date().toISOString(),
    }

    this.traces.set(id, trace)
    return trace
  }

  async findById(id: string): Promise<UnderwritingDecisionTrace | null> {
    return this.traces.get(id) || null
  }

  async findByApplicationId(applicationId: string): Promise<UnderwritingDecisionTrace[]> {
    return Array.from(this.traces.values()).filter((t) => t.applicationId === applicationId)
  }

  async findByUserId(userId: string): Promise<UnderwritingDecisionTrace[]> {
    return Array.from(this.traces.values()).filter((t) => t.userId === userId)
  }

  async list(filters?: {
    decision?: UnderwritingDecision
    limit?: number
    offset?: number
  }): Promise<{ traces: UnderwritingDecisionTrace[]; total: number }> {
    let traces = Array.from(this.traces.values())

    if (filters?.decision) {
      traces = traces.filter((t) => t.decision === filters.decision)
    }

    // Sort by createdAt descending
    traces.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const total = traces.length
    const offset = filters?.offset || 0
    const limit = filters?.limit || 50

    const paginatedTraces = traces.slice(offset, offset + limit)

    return { traces: paginatedTraces, total }
  }

  // Test helper
  async clear(): Promise<void> {
    this.traces.clear()
    this.counter = 1
  }
}

/**
 * PostgreSQL implementation
 */
export class PostgresUnderwritingDecisionTraceStore implements UnderwritingDecisionTraceStore {
  async create(input: CreateUnderwritingDecisionTraceInput): Promise<UnderwritingDecisionTrace> {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')

    const result = await pool.query(
      `INSERT INTO underwriting_decision_traces (
        application_id, user_id, decision, total_score, max_score,
        triggered_rules, decision_reason, rule_config_version, evaluated_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *`,
      [
        input.applicationId,
        input.userId,
        input.decision,
        input.totalScore,
        input.maxScore,
        JSON.stringify(input.triggeredRules),
        input.decisionReason,
        input.ruleConfigVersion,
        input.evaluatedAt,
      ],
    )

    return this.mapRow(result.rows[0])
  }

  async findById(id: string): Promise<UnderwritingDecisionTrace | null> {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')

    const result = await pool.query('SELECT * FROM underwriting_decision_traces WHERE id = $1', [id])

    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async findByApplicationId(applicationId: string): Promise<UnderwritingDecisionTrace[]> {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')

    const result = await pool.query(
      'SELECT * FROM underwriting_decision_traces WHERE application_id = $1 ORDER BY created_at DESC',
      [applicationId],
    )

    return result.rows.map((row) => this.mapRow(row))
  }

  async findByUserId(userId: string): Promise<UnderwritingDecisionTrace[]> {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')

    const result = await pool.query(
      'SELECT * FROM underwriting_decision_traces WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    )

    return result.rows.map((row) => this.mapRow(row))
  }

  async list(filters?: {
    decision?: UnderwritingDecision
    limit?: number
    offset?: number
  }): Promise<{ traces: UnderwritingDecisionTrace[]; total: number }> {
    const pool = await getPool()
    if (!pool) throw new Error('Database pool not initialized')

    const limit = filters?.limit || 50
    const offset = filters?.offset || 0
    const params: any[] = [limit, offset]
    let query = 'SELECT * FROM underwriting_decision_traces'

    if (filters?.decision) {
      params.unshift(filters.decision)
      query += ' WHERE decision = $3'
    }

    query += ' ORDER BY created_at DESC LIMIT $1 OFFSET $2'

    const result = await pool.query(query, params)
    const traces = result.rows.map((row) => this.mapRow(row))

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM underwriting_decision_traces'
    const countParams: any[] = []
    if (filters?.decision) {
      countParams.push(filters.decision)
      countQuery += ' WHERE decision = $1'
    }

    const countResult = await pool.query(countQuery, countParams)
    const total = parseInt(countResult.rows[0].count)

    return { traces, total }
  }

  private mapRow(row: any): UnderwritingDecisionTrace {
    return {
      id: row.id,
      applicationId: row.application_id,
      userId: row.user_id,
      decision: row.decision,
      totalScore: parseFloat(row.total_score),
      maxScore: parseFloat(row.max_score),
      triggeredRules: row.triggered_rules,
      decisionReason: row.decision_reason,
      ruleConfigVersion: row.rule_config_version,
      evaluatedAt: row.evaluated_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    }
  }
}

// Singleton instance
let underwritingDecisionTraceStore: UnderwritingDecisionTraceStore =
  new InMemoryUnderwritingDecisionTraceStore()

export function initUnderwritingDecisionTraceStore(
  store: UnderwritingDecisionTraceStore,
): void {
  underwritingDecisionTraceStore = store
}

export { underwritingDecisionTraceStore }
