import { randomUUID } from 'node:crypto'
import { getPool } from '../db.js'
import type {
  AttachExternalRefInput,
  CreateNgnDepositInput,
  NgnDeposit,
  NgnDepositStatus,
} from './ngnDeposit.js'

function mapRow(row: any): NgnDeposit {
  return {
    depositId: String(row.deposit_id),
    userId: String(row.user_id),
    amountNgn: Number(row.amount_ngn),
    rail: row.rail,
    externalRefSource: row.external_ref_source ?? null,
    externalRef: row.external_ref ?? null,
    redirectUrl: row.redirect_url ?? null,
    bankDetails: row.bank_details ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

class NgnDepositStore {
  private byId = new Map<string, NgnDeposit>()
  private byCanonical = new Map<string, string>()
  private byIdempotency = new Map<string, string>()

  private async pool() {
    const pool = await getPool()
    return pool
  }

  async getById(depositId: string): Promise<NgnDeposit | null> {
    const pool = await this.pool()
    if (!pool) {
      return this.byId.get(depositId) ?? null
    }

    const { rows } = await pool.query(`SELECT * FROM ngn_deposits WHERE deposit_id=$1`, [depositId])
    const row = rows[0]
    return row ? mapRow(row) : null
  }

  async getByUserIdAndIdempotencyKey(userId: string, idempotencyKey: string): Promise<NgnDeposit | null> {
    const pool = await this.pool()
    if (!pool) {
      const key = `${userId}:${idempotencyKey}`
      const id = this.byIdempotency.get(key)
      if (!id) return null
      return this.byId.get(id) ?? null
    }

    const { rows } = await pool.query(
      `SELECT * FROM ngn_deposits WHERE user_id=$1 AND idempotency_key=$2 ORDER BY created_at DESC LIMIT 1`,
      [userId, idempotencyKey],
    )
    const row = rows[0]
    return row ? mapRow(row) : null
  }

  async getByCanonical(externalRefSource: string, externalRef: string): Promise<NgnDeposit | null> {
    const pool = await this.pool()
    if (!pool) {
      const id = this.byCanonical.get(`${externalRefSource}:${externalRef}`)
      if (!id) return null
      return this.byId.get(id) ?? null
    }

    const { rows } = await pool.query(
      `SELECT * FROM ngn_deposits WHERE external_ref_source=$1 AND external_ref=$2 ORDER BY created_at DESC LIMIT 1`,
      [externalRefSource, externalRef],
    )
    const row = rows[0]
    return row ? mapRow(row) : null
  }

  async create(input: CreateNgnDepositInput): Promise<NgnDeposit> {
    const pool = await this.pool()
    if (!pool) {
      const now = new Date()
      const deposit: NgnDeposit = {
        depositId: randomUUID(),
        userId: input.userId,
        amountNgn: input.amountNgn,
        rail: input.rail,
        externalRefSource: null,
        externalRef: null,
        redirectUrl: null,
        bankDetails: null,
        idempotencyKey: input.idempotencyKey ?? null,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      }
      this.byId.set(deposit.depositId, deposit)
      if (deposit.idempotencyKey) {
        this.byIdempotency.set(`${deposit.userId}:${deposit.idempotencyKey}`, deposit.depositId)
      }
      return deposit
    }

    const { rows } = await pool.query(
      `INSERT INTO ngn_deposits (user_id, amount_ngn, rail, idempotency_key)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.userId, Math.trunc(input.amountNgn), input.rail, input.idempotencyKey ?? null],
    )

    return mapRow(rows[0])
  }

  async attachExternalRef(input: AttachExternalRefInput): Promise<NgnDeposit | null> {
    const pool = await this.pool()
    if (!pool) {
      const existing = this.byId.get(input.depositId)
      if (!existing) return null
      const updated: NgnDeposit = {
        ...existing,
        externalRefSource: input.externalRefSource,
        externalRef: input.externalRef,
        redirectUrl: input.redirectUrl ?? null,
        bankDetails: input.bankDetails ?? null,
        updatedAt: new Date(),
      }
      this.byId.set(existing.depositId, updated)
      this.byCanonical.set(`${input.externalRefSource}:${input.externalRef}`, existing.depositId)
      return updated
    }

    const { rows } = await pool.query(
      `UPDATE ngn_deposits
       SET external_ref_source=$2,
           external_ref=$3,
           redirect_url=$4,
           bank_details=$5,
           updated_at=NOW()
       WHERE deposit_id=$1
       RETURNING *`,
      [
        input.depositId,
        input.externalRefSource,
        input.externalRef,
        input.redirectUrl ?? null,
        input.bankDetails ?? null,
      ],
    )
    const row = rows[0]
    return row ? mapRow(row) : null
  }

  async setStatusById(depositId: string, status: NgnDepositStatus): Promise<NgnDeposit | null> {
    const pool = await this.pool()
    if (!pool) {
      const existing = this.byId.get(depositId)
      if (!existing) return null
      if (existing.status === status) return existing
      const updated: NgnDeposit = { ...existing, status, updatedAt: new Date() }
      this.byId.set(depositId, updated)
      return updated
    }

    const { rows } = await pool.query(
      `UPDATE ngn_deposits SET status=$2, updated_at=NOW() WHERE deposit_id=$1 RETURNING *`,
      [depositId, status],
    )
    const row = rows[0]
    return row ? mapRow(row) : null
  }

  async setStatusByCanonical(
    externalRefSource: string,
    externalRef: string,
    status: NgnDepositStatus,
  ): Promise<NgnDeposit | null> {
    const existing = await this.getByCanonical(externalRefSource, externalRef)
    if (!existing) return null
    return this.setStatusById(existing.depositId, status)
  }

  async clear(): Promise<void> {
    const pool = await this.pool()
    if (pool) {
      await pool.query('DELETE FROM ngn_deposits')
      return
    }

    this.byId.clear()
    this.byCanonical.clear()
    this.byIdempotency.clear()
  }
}

export const ngnDepositStore = new NgnDepositStore()
