import { getPool } from '../db.js'

export type TimelockStatus = 'queued' | 'executed' | 'cancelled';

export interface TimelockTransaction {
  txHash: string;
  target: string;
  functionName: string;
  args: any[];
  eta: number;
  status: TimelockStatus;
  ledger: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimelockRepository {
  upsert(tx: Partial<TimelockTransaction> & { txHash: string; ledger: number }): Promise<void>;
  updateStatus(txHash: string, status: TimelockStatus, ledger: number): Promise<void>;
  findAll(): Promise<TimelockTransaction[]>;
  getCheckpoint(): Promise<number | null>;
  saveCheckpoint(ledger: number): Promise<void>;
}

export class StubTimelockRepository implements TimelockRepository {
  private store = new Map<string, TimelockTransaction>();
  private checkpoint: number | null = null;

  async upsert(tx: Partial<TimelockTransaction> & { txHash: string; ledger: number }) {
    const existing = this.store.get(tx.txHash);
    const now = new Date();
    this.store.set(tx.txHash, {
      txHash: tx.txHash,
      target: tx.target ?? existing?.target ?? '',
      functionName: tx.functionName ?? existing?.functionName ?? '',
      args: tx.args ?? existing?.args ?? [],
      eta: tx.eta ?? existing?.eta ?? 0,
      status: tx.status ?? existing?.status ?? 'queued',
      ledger: tx.ledger,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async updateStatus(txHash: string, status: TimelockStatus, ledger: number) {
    const existing = this.store.get(txHash);
    if (!existing) return;
    this.store.set(txHash, {
      ...existing,
      status,
      ledger,
      updatedAt: new Date(),
    });
  }

  async findAll() {
    return Array.from(this.store.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getCheckpoint() {
    return this.checkpoint;
  }

  async saveCheckpoint(ledger: number) {
    this.checkpoint = ledger;
  }
}

export class PostgresTimelockRepository implements TimelockRepository {
  private async pool() {
    const pool = await getPool();
    if (!pool) throw new Error('Postgres pool not available');
    return pool;
  }

  async upsert(tx: Partial<TimelockTransaction> & { txHash: string; ledger: number }): Promise<void> {
    const pool = await this.pool();
    await pool.query(
      `INSERT INTO timelock_transactions (
        tx_hash, target, function_name, args, eta, status, ledger, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (tx_hash) DO UPDATE SET
        target = COALESCE(EXCLUDED.target, timelock_transactions.target),
        function_name = COALESCE(EXCLUDED.function_name, timelock_transactions.function_name),
        args = COALESCE(EXCLUDED.args, timelock_transactions.args),
        eta = COALESCE(EXCLUDED.eta, timelock_transactions.eta),
        status = EXCLUDED.status,
        ledger = EXCLUDED.ledger,
        updated_at = NOW()`,
      [
        tx.txHash,
        tx.target ?? null,
        tx.functionName ?? null,
        tx.args ? JSON.stringify(tx.args) : null,
        tx.eta ?? null,
        tx.status ?? 'queued',
        tx.ledger,
      ]
    );
  }

  async updateStatus(txHash: string, status: TimelockStatus, ledger: number): Promise<void> {
    const pool = await this.pool();
    await pool.query(
      `UPDATE timelock_transactions 
       SET status = $1, ledger = $2, updated_at = NOW()
       WHERE tx_hash = $3`,
      [status, ledger, txHash]
    );
  }

  async findAll(): Promise<TimelockTransaction[]> {
    const pool = await this.pool();
    const { rows } = await pool.query(
      'SELECT * FROM timelock_transactions ORDER BY created_at DESC'
    );
    return rows.map(this.mapRow);
  }

  async getCheckpoint(): Promise<number | null> {
    const pool = await this.pool();
    const { rows } = await pool.query(
      "SELECT last_ledger FROM indexer_checkpoint WHERE name = 'timelock_indexer'"
    );
    if (!rows.length) return null;
    return parseInt(rows[0].last_ledger, 10);
  }

  async saveCheckpoint(ledger: number): Promise<void> {
    const pool = await this.pool();
    await pool.query(
      `INSERT INTO indexer_checkpoint (name, last_ledger, updated_at)
       VALUES ('timelock_indexer', $1, NOW())
       ON CONFLICT (name) DO UPDATE SET last_ledger = EXCLUDED.last_ledger, updated_at = NOW()`,
      [ledger]
    );
  }

  private mapRow(row: any): TimelockTransaction {
    return {
      txHash: row.tx_hash,
      target: row.target,
      functionName: row.function_name,
      args: typeof row.args === 'string' ? JSON.parse(row.args) : row.args,
      eta: parseInt(row.eta, 10),
      status: row.status,
      ledger: parseInt(row.ledger, 10),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
