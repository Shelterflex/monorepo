import { randomUUID } from 'node:crypto'
import type { Deposit, DepositStatus } from './deposit.js'

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

class DepositStore {
  private deposits = new Map<string, Deposit>()

  async add(input: Omit<Deposit, 'id' | 'createdAt'> & { createdAt?: Date }): Promise<Deposit> {
    const id = randomUUID()
    const createdAt = input.createdAt ?? new Date()
    const deposit: Deposit = { id, createdAt, ...input }
    this.deposits.set(id, deposit)
    return deposit
  }

  async listByStatus(
    status: DepositStatus | undefined,
    page = 1,
    pageSize = 20,
  ): Promise<Paginated<Deposit>> {
    const all = Array.from(this.deposits.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )
    const filtered = status ? all.filter((d) => d.status === status) : all
    const total = filtered.length
    const totalPages = Math.ceil(total / pageSize) || 1
    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize)
    return { items, total, page, pageSize, totalPages }
  }

  async clear(): Promise<void> {
    this.deposits.clear()
  }
}

export const depositStore = new DepositStore()

