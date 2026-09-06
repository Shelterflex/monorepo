/**
 * In-memory store for Deal management (MVP)
 * Following the same pattern as listingStore.ts
 */

import { randomUUID } from 'node:crypto'
import { getPool, type PgPoolLike } from '../db.js'
import {
  Deal,
  CreateDealInput,
  DealWithSchedule,
  ScheduleItem,
  DealFilters,
  PaginatedDeals,
  DealStatus,
  ScheduleItemStatus,
  RepaymentMethod,
} from './deal.js'
import { generateRepaymentSchedule } from '../utils/scheduleGenerator.js'
import {
  enqueueSettlementSideEffectsInTransaction,
  enqueueSettlementSideEffectsMemory,
} from '../settlement/enqueueSideEffects.js'

export interface StoredDeal extends Deal {
  schedule: ScheduleItem[]
}

interface DealStorePort {
  create(input: CreateDealInput): Promise<DealWithSchedule>
  findById(dealId: string): Promise<DealWithSchedule | null>
  findByIds(dealIds: string[]): Promise<DealWithSchedule[]>
  findMany(filters?: DealFilters): Promise<PaginatedDeals>
  listActiveDealsWithSchedules(): Promise<DealWithSchedule[]>
  updateStatus(dealId: string, status: DealStatus): Promise<DealWithSchedule | null>
  updateScheduleItemStatus(
    dealId: string,
    period: number,
    status: ScheduleItemStatus,
  ): Promise<DealWithSchedule | null>
  /** Test helper: override instalment due date (in-memory adapter only). */
  setScheduleDueDateForTest(dealId: string, period: number, dueDateIso: string): Promise<void>
  updateRepaymentMethod(
    dealId: string,
    repaymentMethod: RepaymentMethod,
    options?: { employerId?: string; employeeId?: string; deductionDay?: number },
  ): Promise<DealWithSchedule | null>
  clear(): Promise<void>
}

const DEFAULT_PAGE_SIZE = 20

function validateCreateInput(input: CreateDealInput): void {
  if (input.annualRentNgn <= 0) {
    throw new Error('Annual rent must be greater than 0')
  }

  if (input.depositNgn < input.annualRentNgn * 0.2) {
    throw new Error('Deposit must be at least 20% of annual rent')
  }

  const allowedTerms = [3, 6, 12]
  if (!allowedTerms.includes(input.termMonths)) {
    throw new Error(`Term months must be one of: ${allowedTerms.join(', ')}`)
  }

  if (input.depositNgn >= input.annualRentNgn) {
    throw new Error('Deposit must be less than annual rent')
  }
}

class InMemoryDealStore implements DealStorePort {
  private deals: Map<string, StoredDeal> = new Map()

  async create(input: CreateDealInput): Promise<DealWithSchedule> {
    validateCreateInput(input)

    const dealId = randomUUID()
    const now = new Date()

    const schedule = generateRepaymentSchedule({
      annualRentNgn: input.annualRentNgn,
      depositNgn: input.depositNgn,
      termMonths: input.termMonths,
      startDate: now,
    })

    const deal: StoredDeal = {
      dealId,
      tenantId: input.tenantId,
      landlordId: input.landlordId,
      listingId: input.listingId,
      annualRentNgn: input.annualRentNgn,
      depositNgn: input.depositNgn,
      financedAmountNgn: input.annualRentNgn - input.depositNgn,
      termMonths: input.termMonths,
      createdAt: now,
      status: DealStatus.DRAFT,
      repaymentMethod: input.repaymentMethod ?? 'self_pay',
      employerId: input.employerId,
      employeeId: input.employeeId,
      deductionDay: input.deductionDay,
      schedule,
    }

    this.deals.set(dealId, deal)

    return {
      ...deal,
      schedule: [...schedule],
    }
  }

  async findById(dealId: string): Promise<DealWithSchedule | null> {
    const deal = this.deals.get(dealId)
    if (!deal) return null

    return {
      ...deal,
      schedule: [...deal.schedule],
    }
  }

  async findByIds(dealIds: string[]): Promise<DealWithSchedule[]> {
    const result: DealWithSchedule[] = []
    for (const dealId of new Set(dealIds)) {
      const deal = this.deals.get(dealId)
      if (deal) {
        result.push({
          ...deal,
          schedule: [...deal.schedule],
        })
      }
    }
    return result
  }

  async listActiveDealsWithSchedules(): Promise<DealWithSchedule[]> {
    return Array.from(this.deals.values())
      .filter((d) => d.status === DealStatus.ACTIVE || d.status === DealStatus.AT_RISK)
      .map((deal) => ({
        ...deal,
        schedule: [...deal.schedule],
      }))
  }

  async findMany(filters: DealFilters = {}): Promise<PaginatedDeals> {
    let filteredDeals = Array.from(this.deals.values())

    if (filters.tenantId) {
      filteredDeals = filteredDeals.filter((deal) => deal.tenantId === filters.tenantId)
    }
    if (filters.landlordId) {
      filteredDeals = filteredDeals.filter((deal) => deal.landlordId === filters.landlordId)
    }
    if (filters.status) {
      filteredDeals = filteredDeals.filter((deal) => deal.status === filters.status)
    }

    filteredDeals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    const page = filters.page || 1
    const pageSize = filters.pageSize || DEFAULT_PAGE_SIZE
    const startIndex = (page - 1) * pageSize
    const endIndex = startIndex + pageSize

    const paginatedDeals = filteredDeals.slice(startIndex, endIndex)

    return {
      deals: paginatedDeals.map((deal) => ({
        dealId: deal.dealId,
        tenantId: deal.tenantId,
        landlordId: deal.landlordId,
        listingId: deal.listingId,
        annualRentNgn: deal.annualRentNgn,
        depositNgn: deal.depositNgn,
        financedAmountNgn: deal.financedAmountNgn,
        termMonths: deal.termMonths,
        createdAt: deal.createdAt,
        status: deal.status,
        repaymentMethod: deal.repaymentMethod,
        employerId: deal.employerId,
        employeeId: deal.employeeId,
        deductionDay: deal.deductionDay,
      })),
      total: filteredDeals.length,
      page,
      pageSize,
      totalPages: Math.ceil(filteredDeals.length / pageSize),
    }
  }

  async updateStatus(dealId: string, status: DealStatus): Promise<DealWithSchedule | null> {
    const deal = this.deals.get(dealId)
    if (!deal) return null

    deal.status = status

    return {
      ...deal,
      schedule: [...deal.schedule],
    }
  }

  async updateScheduleItemStatus(
    dealId: string,
    period: number,
    status: ScheduleItemStatus,
  ): Promise<DealWithSchedule | null> {
    const deal = this.deals.get(dealId)
    if (!deal) return null

    const scheduleItem = deal.schedule.find((item) => item.period === period)
    if (!scheduleItem) return null

    const oldStatus = scheduleItem.status
    scheduleItem.status = status
    if (status === ScheduleItemStatus.PAID && oldStatus !== ScheduleItemStatus.PAID) {
      enqueueSettlementSideEffectsMemory({
        dealId,
        period,
        tenantId: deal.tenantId,
        landlordId: deal.landlordId,
        amountNgn: scheduleItem.amountNgn,
      })
    }

    return {
      ...deal,
      schedule: [...deal.schedule],
    }
  }

  async setScheduleDueDateForTest(
    dealId: string,
    period: number,
    dueDateIso: string,
  ): Promise<void> {
    const deal = this.deals.get(dealId)
    if (!deal) throw new Error(`Deal ${dealId} not found`)
    const item = deal.schedule.find((s) => s.period === period)
    if (!item) throw new Error(`Period ${period} not found`)
    item.dueDate = dueDateIso
  }

  async updateRepaymentMethod(
    dealId: string,
    repaymentMethod: RepaymentMethod,
    options?: { employerId?: string; employeeId?: string; deductionDay?: number },
  ): Promise<DealWithSchedule | null> {
    const deal = this.deals.get(dealId)
    if (!deal) return null

    deal.repaymentMethod = repaymentMethod
    if (repaymentMethod === 'salary_deduction') {
      deal.employerId = options?.employerId
      deal.employeeId = options?.employeeId
      deal.deductionDay = options?.deductionDay
    } else {
      deal.employerId = undefined
      deal.employeeId = undefined
      deal.deductionDay = undefined
    }

    return {
      ...deal,
      schedule: [...deal.schedule],
    }
  }

  async clear(): Promise<void> {
    this.deals.clear()
  }
}

type DealRow = {
  deal_id: string
  tenant_id: string
  landlord_id: string
  listing_id: string | null
  annual_rent_ngn: string | number
  deposit_ngn: string | number
  financed_amount_ngn: string | number
  term_months: number
  status: DealStatus
  created_at: Date
  updated_at: Date
}

type ScheduleRow = {
  period: number
  due_date: Date
  amount_ngn: string | number
  status: ScheduleItemStatus
}

class PostgresDealStore implements DealStorePort {
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

  async create(input: CreateDealInput): Promise<DealWithSchedule> {
    validateCreateInput(input)

    const schedule = generateRepaymentSchedule({
      annualRentNgn: input.annualRentNgn,
      depositNgn: input.depositNgn,
      termMonths: input.termMonths,
      startDate: new Date(),
    })

    const dealId = randomUUID()
    const pool = await this.pool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      const dealResult = await client.query(
        `INSERT INTO tenant_deals (
          deal_id,
          tenant_id,
          landlord_id,
          listing_id,
          annual_rent_ngn,
          deposit_ngn,
          financed_amount_ngn,
          term_months,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          dealId,
          input.tenantId,
          input.landlordId,
          input.listingId ?? null,
          input.annualRentNgn,
          input.depositNgn,
          input.annualRentNgn - input.depositNgn,
          input.termMonths,
          DealStatus.DRAFT,
        ],
      )

      const row = dealResult.rows[0] as DealRow

      if (schedule.length > 0) {
        const columnsPerRow = 5
        const valuesClause = schedule
          .map((_, i) => {
            const base = i * columnsPerRow
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
          })
          .join(', ')
        const scheduleParams = schedule.flatMap((item) => [
          dealId,
          item.period,
          new Date(item.dueDate),
          item.amountNgn,
          item.status,
        ])
        await client.query(
          `INSERT INTO tenant_deal_schedules (
            deal_id,
            period,
            due_date,
            amount_ngn,
            status
          ) VALUES ${valuesClause}`,
          scheduleParams,
        )
      }

      await client.query('COMMIT')

      return {
        ...this.mapDeal(row),
        schedule,
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async findById(dealId: string): Promise<DealWithSchedule | null> {
    const pool = await this.pool()
    return this.fetchDealWithSchedule(pool, dealId)
  }

  async findByIds(dealIds: string[]): Promise<DealWithSchedule[]> {
    const uniqueIds = [...new Set(dealIds)]
    if (uniqueIds.length === 0) {
      return []
    }

    const pool = await this.pool()
    const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(', ')
    const { rows } = await pool.query(
      `SELECT
        td.deal_id, td.tenant_id, td.landlord_id, td.listing_id,
        td.annual_rent_ngn, td.deposit_ngn, td.financed_amount_ngn,
        td.term_months, td.status AS deal_status, td.created_at, td.updated_at,
        tds.period, tds.due_date, tds.amount_ngn, tds.status AS schedule_status
      FROM tenant_deals td
      LEFT JOIN tenant_deal_schedules tds ON tds.deal_id = td.deal_id
      WHERE td.deal_id IN (${placeholders})
        AND td.deleted_at IS NULL
      ORDER BY td.deal_id, tds.period ASC`,
      uniqueIds,
    )

    const dealMap = new Map<string, DealWithSchedule>()
    for (const row of rows as Array<Record<string, unknown>>) {
      const dealId = row.deal_id as string
      if (!dealMap.has(dealId)) {
        dealMap.set(dealId, {
          ...this.mapDeal({ ...row, status: row.deal_status } as DealRow),
          schedule: [],
        })
      }
      if (row.period != null) {
        const entry = dealMap.get(dealId)!
        entry.schedule.push({
          period: row.period as number,
          dueDate: new Date(row.due_date as string).toISOString(),
          amountNgn: toNumber(row.amount_ngn as string | number),
          status: row.schedule_status as ScheduleItemStatus,
        })
      }
    }
    return Array.from(dealMap.values())
  }

  async listActiveDealsWithSchedules(): Promise<DealWithSchedule[]> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `SELECT
        td.deal_id, td.tenant_id, td.landlord_id, td.listing_id,
        td.annual_rent_ngn, td.deposit_ngn, td.financed_amount_ngn,
        td.term_months, td.status AS deal_status, td.created_at, td.updated_at,
        tds.period, tds.due_date, tds.amount_ngn, tds.status AS schedule_status
      FROM tenant_deals td
      LEFT JOIN tenant_deal_schedules tds ON tds.deal_id = td.deal_id
      WHERE td.status IN ('active', 'at_risk')
        AND td.deleted_at IS NULL
      ORDER BY td.deal_id, tds.period ASC`,
    )

    const dealMap = new Map<string, DealWithSchedule>()
    for (const row of rows as Array<Record<string, unknown>>) {
      const dealId = row.deal_id as string
      if (!dealMap.has(dealId)) {
        dealMap.set(dealId, {
          ...this.mapDeal({ ...row, status: row.deal_status } as DealRow),
          schedule: [],
        })
      }
      if (row.period != null) {
        const entry = dealMap.get(dealId)!
        entry.schedule.push({
          period: row.period as number,
          dueDate: new Date(row.due_date as string).toISOString(),
          amountNgn: toNumber(row.amount_ngn as string | number),
          status: row.schedule_status as ScheduleItemStatus,
        })
      }
    }
    return Array.from(dealMap.values())
  }

  async findMany(filters: DealFilters = {}): Promise<PaginatedDeals> {
    const pool = await this.pool()
    const where: string[] = ['deleted_at IS NULL']
    const values: unknown[] = []

    if (filters.tenantId) {
      values.push(filters.tenantId)
      where.push(`tenant_id = $${values.length}`)
    }

    if (filters.landlordId) {
      values.push(filters.landlordId)
      where.push(`landlord_id = $${values.length}`)
    }

    if (filters.status) {
      values.push(filters.status)
      where.push(`status = $${values.length}`)
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const page = filters.page && filters.page > 0 ? filters.page : 1
    const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : DEFAULT_PAGE_SIZE
    const offset = (page - 1) * pageSize

    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM tenant_deals ${whereClause}`,
      values,
    )

    const queryValues = [...values, pageSize, offset]
    const dataResult = await pool.query(
      `SELECT * FROM tenant_deals ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      queryValues,
    )

    const total = Number((countResult.rows[0] as { count: string }).count)
    const deals = dataResult.rows.map((row) => this.mapDeal(row as DealRow))

    return {
      deals,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  async updateStatus(dealId: string, status: DealStatus): Promise<DealWithSchedule | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      `UPDATE tenant_deals
       SET status = $2, updated_at = NOW()
       WHERE deal_id = $1
       RETURNING *`,
      [dealId, status],
    )

    if (rows.length === 0) {
      return null
    }

    return this.fetchDealWithSchedule(pool, dealId)
  }

  async updateScheduleItemStatus(
    dealId: string,
    period: number,
    status: ScheduleItemStatus,
  ): Promise<DealWithSchedule | null> {
    const pool = await this.pool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows: cur } = await client.query(
        `SELECT status, amount_ngn
         FROM tenant_deal_schedules
         WHERE deal_id = $1 AND period = $2
         FOR UPDATE`,
        [dealId, period],
      )
      if (cur.length === 0) {
        await client.query('ROLLBACK')
        return null
      }
      const row0 = cur[0] as {
        status: string
        amount_ngn: string | number
      }
      const oldStatus = row0.status
      const amountNgn = toNumber(row0.amount_ngn)
      const { rows: trows } = await client.query(
        `SELECT tenant_id, landlord_id FROM tenant_deals WHERE deal_id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [dealId],
      )
      if (trows.length === 0) {
        await client.query('ROLLBACK')
        return null
      }
      const t0 = trows[0] as { tenant_id: string; landlord_id: string }

      await client.query(
        `UPDATE tenant_deal_schedules
         SET status = $3, updated_at = NOW()
         WHERE deal_id = $1 AND period = $2`,
        [dealId, period, status],
      )

      if (status === ScheduleItemStatus.PAID && oldStatus !== ScheduleItemStatus.PAID) {
        await enqueueSettlementSideEffectsInTransaction(client, {
          dealId,
          period,
          tenantId: t0.tenant_id,
          landlordId: t0.landlord_id,
          amountNgn,
        })
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }

    return this.fetchDealWithSchedule(pool, dealId)
  }

  async setScheduleDueDateForTest(
    dealId: string,
    period: number,
    dueDateIso: string,
  ): Promise<void> {
    const pool = await this.pool()
    await pool.query(
      `UPDATE tenant_deal_schedules SET due_date = $3, updated_at = NOW()
       WHERE deal_id = $1 AND period = $2`,
      [dealId, period, new Date(dueDateIso)],
    )
  }

  async clear(): Promise<void> {
    const pool = await this.pool()
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('dealStore.clear() is only supported in test env when using Postgres')
    }
    await pool.query('TRUNCATE tenant_deal_schedules RESTART IDENTITY CASCADE')
    await pool.query('TRUNCATE tenant_deals RESTART IDENTITY CASCADE')
  }

  async updateRepaymentMethod(
    dealId: string,
    repaymentMethod: RepaymentMethod,
    options?: { employerId?: string; employeeId?: string; deductionDay?: number },
  ): Promise<DealWithSchedule | null> {
    void repaymentMethod
    void options
    return this.findById(dealId)
  }

  private mapDeal(row: DealRow): Deal {
    return {
      dealId: row.deal_id,
      tenantId: row.tenant_id,
      landlordId: row.landlord_id,
      listingId: row.listing_id ?? undefined,
      annualRentNgn: toNumber(row.annual_rent_ngn),
      depositNgn: toNumber(row.deposit_ngn),
      financedAmountNgn: toNumber(row.financed_amount_ngn),
      termMonths: row.term_months,
      createdAt: new Date(row.created_at),
      status: row.status,
      repaymentMethod: 'self_pay',
    }
  }

  private async fetchDealWithSchedule(
    pool: PgPoolLike,
    dealId: string,
  ): Promise<DealWithSchedule | null> {
    const { rows } = await pool.query('SELECT * FROM tenant_deals WHERE deal_id = $1 AND deleted_at IS NULL', [dealId])
    if (rows.length === 0) {
      return null
    }

    const deal = this.mapDeal(rows[0] as DealRow)
    const scheduleRows = await pool.query(
      `SELECT period, due_date, amount_ngn, status
       FROM tenant_deal_schedules
       WHERE deal_id = $1
       ORDER BY period ASC`,
      [dealId],
    )

    return {
      ...deal,
      schedule: scheduleRows.rows.map((row) => this.mapScheduleRow(row as ScheduleRow)),
    }
  }

  private mapScheduleRow(row: ScheduleRow): ScheduleItem {
    return {
      period: row.period,
      dueDate: new Date(row.due_date).toISOString(),
      amountNgn: toNumber(row.amount_ngn),
      status: row.status,
    }
  }
}

class HybridDealStore implements DealStorePort {
  private memory = new InMemoryDealStore()
  private postgres = new PostgresDealStore()

  private async adapter(): Promise<DealStorePort> {
    if (await this.postgres.isAvailable()) {
      return this.postgres
    }
    return this.memory
  }

  async create(input: CreateDealInput): Promise<DealWithSchedule> {
    const adapter = await this.adapter()
    return adapter.create(input)
  }

  async findById(dealId: string): Promise<DealWithSchedule | null> {
    const adapter = await this.adapter()
    return adapter.findById(dealId)
  }

  async findByIds(dealIds: string[]): Promise<DealWithSchedule[]> {
    const adapter = await this.adapter()
    return adapter.findByIds(dealIds)
  }

  async findMany(filters: DealFilters = {}): Promise<PaginatedDeals> {
    const adapter = await this.adapter()
    return adapter.findMany(filters)
  }

  async listActiveDealsWithSchedules(): Promise<DealWithSchedule[]> {
    const adapter = await this.adapter()
    return adapter.listActiveDealsWithSchedules()
  }

  async updateStatus(dealId: string, status: DealStatus): Promise<DealWithSchedule | null> {
    const adapter = await this.adapter()
    return adapter.updateStatus(dealId, status)
  }

  async updateScheduleItemStatus(
    dealId: string,
    period: number,
    status: ScheduleItemStatus,
  ): Promise<DealWithSchedule | null> {
    const adapter = await this.adapter()
    return adapter.updateScheduleItemStatus(dealId, period, status)
  }

  async setScheduleDueDateForTest(
    dealId: string,
    period: number,
    dueDateIso: string,
  ): Promise<void> {
    const adapter = await this.adapter()
    return adapter.setScheduleDueDateForTest(dealId, period, dueDateIso)
  }

  async updateRepaymentMethod(
    dealId: string,
    repaymentMethod: RepaymentMethod,
    options?: { employerId?: string; employeeId?: string; deductionDay?: number },
  ): Promise<DealWithSchedule | null> {
    const adapter = await this.adapter()
    return adapter.updateRepaymentMethod(dealId, repaymentMethod, options)
  }

  async clear(): Promise<void> {
    const adapter = await this.adapter()
    return adapter.clear()
  }
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}

export const dealStore = new HybridDealStore()
