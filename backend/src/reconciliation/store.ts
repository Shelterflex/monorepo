import { getPool } from '../db.js'
import { generateId } from '../utils/tokens.js'
import type {
  LedgerEvent,
  ProviderEvent,
  Mismatch,
  MismatchClass,
  MismatchStatus,
  IngestLedgerEventInput,
  IngestProviderEventInput,
} from './types.js'
import { SLA_HOURS_BY_CLASS } from './types.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function rowToLedger(row: Record<string, unknown>): LedgerEvent {
  return {
    id: row.id as string,
    eventType: row.event_type as LedgerEvent['eventType'],
    amountMinor: BigInt(row.amount_minor as string),
    currency: row.currency as string,
    internalRef: row.internal_ref as string,
    rail: row.rail as string,
    userId: row.user_id as string | undefined,
    status: row.status as LedgerEvent['status'],
    occurredAt: new Date(row.occurred_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

function rowToProvider(row: Record<string, unknown>): ProviderEvent {
  return {
    id: row.id as string,
    provider: row.provider as string,
    providerEventId: row.provider_event_id as string,
    eventType: row.event_type as ProviderEvent['eventType'],
    amountMinor: BigInt(row.amount_minor as string),
    currency: row.currency as string,
    internalRef: row.internal_ref as string | undefined,
    rawStatus: row.raw_status as string,
    occurredAt: new Date(row.occurred_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

function rowToMismatch(row: Record<string, unknown>): Mismatch {
  return {
    id: row.id as string,
    mismatchClass: row.mismatch_class as MismatchClass,
    ledgerEventId: row.ledger_event_id as string | undefined,
    providerEventId: row.provider_event_id as string | undefined,
    expectedAmountMinor: row.expected_amount_minor != null ? BigInt(row.expected_amount_minor as string) : undefined,
    actualAmountMinor: row.actual_amount_minor != null ? BigInt(row.actual_amount_minor as string) : undefined,
    toleranceMinor: BigInt(row.tolerance_minor as string),
    status: row.status as MismatchStatus,
    resolutionWorkflow: row.resolution_workflow as string | undefined,
    resolutionAttempts: row.resolution_attempts as number,
    lastResolutionAt: row.last_resolution_at ? new Date(row.last_resolution_at as string) : undefined,
    escalatedAt: row.escalated_at ? new Date(row.escalated_at as string) : undefined,
    slaDeadline: row.sla_deadline ? new Date(row.sla_deadline as string) : undefined,
    traceContext: (row.trace_context as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

// ── Ledger events ─────────────────────────────────────────────────────────────

export async function ingestLedgerEvent(input: IngestLedgerEventInput): Promise<LedgerEvent> {
  const pool = await getPool()
  if (!pool) throw new Error('Database unavailable')
  const { rows } = await pool.query(
    `INSERT INTO reconciliation_ledger_events
       (id, event_type, amount_minor, currency, internal_ref, rail, user_id, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (internal_ref) DO UPDATE SET status = reconciliation_ledger_events.status
     RETURNING *`,
    [
      generateId(),
      input.eventType,
      input.amountMinor.toString(),
      input.currency ?? 'NGN',
      input.internalRef,
      input.rail,
      input.userId ?? null,
      input.occurredAt.toISOString(),
    ],
  )
  return rowToLedger(rows[0])
}

export async function listPendingLedgerEvents(limit = 200): Promise<LedgerEvent[]> {
  const pool = await getPool()
  if (!pool) return []
  const { rows } = await pool.query(
    `SELECT * FROM reconciliation_ledger_events WHERE status = 'pending' ORDER BY occurred_at LIMIT $1`,
    [limit],
  )
  return rows.map(rowToLedger)
}

export async function markLedgerEventStatus(id: string, status: LedgerEvent['status']): Promise<void> {
  const pool = await getPool()
  if (!pool) return
  await pool.query(`UPDATE reconciliation_ledger_events SET status=$1 WHERE id=$2`, [status, id])
}

// ── Provider events ───────────────────────────────────────────────────────────

export async function ingestProviderEvent(input: IngestProviderEventInput): Promise<ProviderEvent> {
  const pool = await getPool()
  if (!pool) throw new Error('Database unavailable')
  const { rows } = await pool.query(
    `INSERT INTO reconciliation_provider_events
       (id, provider, provider_event_id, event_type, amount_minor, currency, internal_ref, raw_status, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (provider, provider_event_id) DO UPDATE SET raw_status = EXCLUDED.raw_status
     RETURNING *`,
    [
      generateId(),
      input.provider,
      input.providerEventId,
      input.eventType,
      input.amountMinor.toString(),
      input.currency ?? 'NGN',
      input.internalRef ?? null,
      input.rawStatus,
      input.occurredAt.toISOString(),
    ],
  )
  return rowToProvider(rows[0])
}

export async function findProviderEventByRef(internalRef: string): Promise<ProviderEvent | null> {
  const pool = await getPool()
  if (!pool) return null
  const { rows } = await pool.query(
    `SELECT * FROM reconciliation_provider_events WHERE internal_ref=$1 ORDER BY occurred_at DESC LIMIT 1`,
    [internalRef],
  )
  return rows.length ? rowToProvider(rows[0]) : null
}

export async function listProviderEventsByRef(internalRef: string): Promise<ProviderEvent[]> {
  const pool = await getPool()
  if (!pool) return []
  const { rows } = await pool.query(
    `SELECT * FROM reconciliation_provider_events WHERE internal_ref=$1 ORDER BY occurred_at`,
    [internalRef],
  )
  return rows.map(rowToProvider)
}

// ── Mismatches ────────────────────────────────────────────────────────────────

export async function persistMismatch(params: {
  mismatchClass: MismatchClass
  ledgerEventId?: string
  providerEventId?: string
  expectedAmountMinor?: bigint
  actualAmountMinor?: bigint
  toleranceMinor: bigint
  traceContext?: Record<string, unknown>
}): Promise<Mismatch> {
  const pool = await getPool()
  if (!pool) throw new Error('Database unavailable')

  const slaHours = SLA_HOURS_BY_CLASS[params.mismatchClass]
  const slaDeadline = new Date(Date.now() + slaHours * 3_600_000)

  const { rows } = await pool.query(
    `INSERT INTO reconciliation_mismatches
       (id, mismatch_class, ledger_event_id, provider_event_id,
        expected_amount_minor, actual_amount_minor, tolerance_minor,
        sla_deadline, trace_context)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      generateId(),
      params.mismatchClass,
      params.ledgerEventId ?? null,
      params.providerEventId ?? null,
      params.expectedAmountMinor?.toString() ?? null,
      params.actualAmountMinor?.toString() ?? null,
      params.toleranceMinor.toString(),
      slaDeadline.toISOString(),
      JSON.stringify(params.traceContext ?? {}),
    ],
  )
  return rowToMismatch(rows[0])
}

export async function listMismatches(params: {
  status?: MismatchStatus
  mismatchClass?: MismatchClass
  limit?: number
  cursorCreatedAt?: Date
}): Promise<Mismatch[]> {
  const pool = await getPool()
  if (!pool) return []

  const conditions: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (params.status) { conditions.push(`status=$${idx++}`); values.push(params.status) }
  if (params.mismatchClass) { conditions.push(`mismatch_class=$${idx++}`); values.push(params.mismatchClass) }
  if (params.cursorCreatedAt) { conditions.push(`created_at < $${idx++}`); values.push(params.cursorCreatedAt.toISOString()) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(params.limit ?? 50, 500)
  values.push(limit)

  const { rows } = await pool.query(
    `SELECT * FROM reconciliation_mismatches ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    values,
  )
  return rows.map(rowToMismatch)
}

export async function updateMismatchStatus(
  id: string,
  status: MismatchStatus,
  extra: {
    resolutionWorkflow?: string
    escalatedAt?: Date
    lastResolutionAt?: Date
    resolutionAttempts?: number
  } = {},
): Promise<void> {
  const pool = await getPool()
  if (!pool) return
  await pool.query(
    `UPDATE reconciliation_mismatches SET
       status=$1,
       resolution_workflow=COALESCE($2, resolution_workflow),
       escalated_at=COALESCE($3, escalated_at),
       last_resolution_at=COALESCE($4, last_resolution_at),
       resolution_attempts=COALESCE($5, resolution_attempts),
       updated_at=NOW()
     WHERE id=$6`,
    [
      status,
      extra.resolutionWorkflow ?? null,
      extra.escalatedAt?.toISOString() ?? null,
      extra.lastResolutionAt?.toISOString() ?? null,
      extra.resolutionAttempts ?? null,
      id,
    ],
  )
}

export async function listOpenMismatchesPastSla(): Promise<Mismatch[]> {
  const pool = await getPool()
  if (!pool) return []
  const { rows } = await pool.query(
    `SELECT * FROM reconciliation_mismatches
     WHERE status='open' AND sla_deadline < NOW()
     ORDER BY sla_deadline`,
  )
  return rows.map(rowToMismatch)
}

export async function getMismatchAgingReport(): Promise<{
  mismatchClass: MismatchClass
  status: MismatchStatus
  count: number
  oldestCreatedAt: Date | null
}[]> {
  const pool = await getPool()
  if (!pool) return []
  const { rows } = await pool.query(
    `SELECT mismatch_class, status, COUNT(*)::int AS count, MIN(created_at) AS oldest_created_at
     FROM reconciliation_mismatches
     GROUP BY mismatch_class, status
     ORDER BY mismatch_class, status`,
  )
  return rows.map((r) => ({
    mismatchClass: r.mismatch_class as MismatchClass,
    status: r.status as MismatchStatus,
    count: r.count as number,
    oldestCreatedAt: r.oldest_created_at ? new Date(r.oldest_created_at as string) : null,
  }))
}
