import { randomUUID } from 'node:crypto'
import { getPool, type PgPoolLike } from '../db.js'
import { Reward, RewardStatus, CreateRewardInput } from './reward.js'
import { TxType } from '../outbox/types.js'

interface RewardStorePort {
  create(input: CreateRewardInput): Promise<Reward>
  getById(rewardId: string): Promise<Reward | null>
  markAsPaid(
    rewardId: string,
    paymentTxId: string,
    externalRefSource: string,
    externalRef: string,
    metadata?: Reward['metadata'],
  ): Promise<Reward | null>
  updateStatus(rewardId: string, status: RewardStatus): Promise<Reward | null>
  listAll(): Promise<Reward[]>
  clear(): Promise<void>
}

class InMemoryRewardStore implements RewardStorePort {
  private rewards = new Map<string, Reward>()

  async create(input: CreateRewardInput): Promise<Reward> {
    const now = new Date()
    const reward: Reward = {
      rewardId: randomUUID(),
      whistleblowerId: input.whistleblowerId,
      dealId: input.dealId,
      listingId: input.listingId,
      amountUsdc: input.amountUsdc,
      status: RewardStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    }

    this.rewards.set(reward.rewardId, reward)
    return reward
  }

  async getById(rewardId: string): Promise<Reward | null> {
    return this.rewards.get(rewardId) ?? null
  }

  async markAsPaid(
    rewardId: string,
    paymentTxId: string,
    externalRefSource: string,
    externalRef: string,
    metadata?: Reward['metadata'],
  ): Promise<Reward | null> {
    const reward = this.rewards.get(rewardId)
    if (!reward) return null

    reward.status = RewardStatus.PAID
    reward.paidAt = new Date()
    reward.updatedAt = new Date()
    reward.paymentTxId = paymentTxId
    reward.externalRefSource = externalRefSource
    reward.externalRef = externalRef
    reward.metadata = metadata
    this.rewards.set(rewardId, reward)
    return reward
  }

  async updateStatus(rewardId: string, status: RewardStatus): Promise<Reward | null> {
    const reward = this.rewards.get(rewardId)
    if (!reward) return null

    const previousStatus = reward.status
    reward.status = status
    reward.updatedAt = new Date()
    this.rewards.set(rewardId, reward)

    // When transitioning to PAYABLE, enqueue on-chain allocate call
    if (previousStatus !== RewardStatus.PAYABLE && status === RewardStatus.PAYABLE) {
      try {
        const { outboxStore } = await import('../outbox/index.js')
        await outboxStore.create({
          txType: TxType.WHISTLEBLOWER_REWARD_ALLOCATE,
          source: 'reward_transition',
          ref: rewardId,
          payload: {
            rewardId,
            whistleblowerId: reward.whistleblowerId,
            amountUsdc: reward.amountUsdc.toString(),
          },
          aggregateId: rewardId,
          aggregateType: 'whistleblower_reward',
          eventType: 'status_changed_to_payable',
        })
      } catch (err) {
        // Log but don't fail the status update
        console.error('Failed to create outbox item for reward allocation:', err)
      }
    }

    return reward
  }

  async listAll(): Promise<Reward[]> {
    return Array.from(this.rewards.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )
  }

  async clear(): Promise<void> {
    this.rewards.clear()
  }
}

type RewardRow = {
  reward_id: string
  whistleblower_id: string
  deal_id: string
  listing_id: string
  amount_usdc: string | number
  status: RewardStatus
  payment_tx_id: string | null
  external_ref_source: string | null
  external_ref: string | null
  metadata: unknown
  paid_at: Date | null
  created_at: Date
  updated_at: Date
}

class PostgresRewardStore implements RewardStorePort {
  private async pool(): Promise<PgPoolLike> {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available (DATABASE_URL/pg not configured)')
    }
    return pool
  }

  async isAvailable(): Promise<boolean> {
    return (await getPool()) !== null
  }

  async create(input: CreateRewardInput): Promise<Reward> {
    const pool = await this.pool()
    const rewardId = randomUUID()
    const { rows } = await pool.query(
      `INSERT INTO whistleblower_rewards (
        reward_id,
        whistleblower_id,
        deal_id,
        listing_id,
        amount_usdc,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        rewardId,
        input.whistleblowerId,
        input.dealId,
        input.listingId,
        input.amountUsdc,
        RewardStatus.PENDING,
      ],
    )

    return this.mapRow(rows[0] as RewardRow)
  }

  async getById(rewardId: string): Promise<Reward | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      'SELECT * FROM whistleblower_rewards WHERE reward_id = $1',
      [rewardId],
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as RewardRow)
  }

  async markAsPaid(
    rewardId: string,
    paymentTxId: string,
    externalRefSource: string,
    externalRef: string,
    metadata?: Reward['metadata'],
  ): Promise<Reward | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE whistleblower_rewards
       SET status = $2,
           payment_tx_id = $3,
           external_ref_source = $4,
           external_ref = $5,
           metadata = $6::jsonb,
           paid_at = NOW(),
           updated_at = NOW()
       WHERE reward_id = $1
       RETURNING *`,
      [
        rewardId,
        RewardStatus.PAID,
        paymentTxId,
        externalRefSource,
        externalRef,
        metadata ? JSON.stringify(metadata) : null,
      ],
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as RewardRow)
  }

  async updateStatus(rewardId: string, status: RewardStatus): Promise<Reward | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE whistleblower_rewards
       SET status = $2,
           updated_at = NOW()
       WHERE reward_id = $1
       RETURNING *`,
      [rewardId, status],
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as RewardRow)
  }

  async listAll(): Promise<Reward[]> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      'SELECT * FROM whistleblower_rewards ORDER BY created_at DESC',
    )
    return rows.map((row) => this.mapRow(row as RewardRow))
  }

  async clear(): Promise<void> {
    const pool = await this.pool()
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('rewardStore.clear() is only supported in test env when using Postgres')
    }
    await pool.query('TRUNCATE whistleblower_rewards RESTART IDENTITY CASCADE')
  }

  private mapRow(row: RewardRow): Reward {
    const metadataValue = row.metadata
    let metadata: Reward['metadata']
    if (metadataValue && typeof metadataValue === 'string') {
      metadata = JSON.parse(metadataValue)
    } else if (metadataValue && typeof metadataValue === 'object') {
      metadata = metadataValue as Reward['metadata']
    }

    return {
      rewardId: row.reward_id,
      whistleblowerId: row.whistleblower_id,
      dealId: row.deal_id,
      listingId: row.listing_id,
      amountUsdc: toNumber(row.amount_usdc),
      status: row.status,
      paymentTxId: row.payment_tx_id ?? undefined,
      externalRefSource: row.external_ref_source ?? undefined,
      externalRef: row.external_ref ?? undefined,
      metadata,
      paidAt: row.paid_at ? new Date(row.paid_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }
}

class HybridRewardStore implements RewardStorePort {
  private memory = new InMemoryRewardStore()
  private postgres = new PostgresRewardStore()

  private async adapter(): Promise<RewardStorePort> {
    if (await this.postgres.isAvailable()) {
      return this.postgres
    }
    return this.memory
  }

  async create(input: CreateRewardInput): Promise<Reward> {
    const adapter = await this.adapter()
    return adapter.create(input)
  }

  async getById(rewardId: string): Promise<Reward | null> {
    const adapter = await this.adapter()
    return adapter.getById(rewardId)
  }

  async markAsPaid(
    rewardId: string,
    paymentTxId: string,
    externalRefSource: string,
    externalRef: string,
    metadata?: Reward['metadata'],
  ): Promise<Reward | null> {
    const adapter = await this.adapter()
    return adapter.markAsPaid(rewardId, paymentTxId, externalRefSource, externalRef, metadata)
  }

  async updateStatus(rewardId: string, status: RewardStatus): Promise<Reward | null> {
    const adapter = await this.adapter()
    return adapter.updateStatus(rewardId, status)
  }

  async listAll(): Promise<Reward[]> {
    const adapter = await this.adapter()
    return adapter.listAll()
  }

  async clear(): Promise<void> {
    const adapter = await this.adapter()
    return adapter.clear()
  }
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}

export const rewardStore = new HybridRewardStore()
