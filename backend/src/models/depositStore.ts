import { randomUUID } from 'node:crypto'
import type { Deposit, DepositStatus } from './deposit.js'

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export class DepositStore {
  private deposits = new Map<string, Deposit>()
  private byCanonical = new Map<string, string>() // canonical external ref -> depositId
  private byProviderRef = new Map<string, string>() // alias for canonical
  private consumed = new Set<string>()

  async add(input: Omit<Deposit, 'id' | 'createdAt'> & { createdAt?: Date }): Promise<Deposit> {
    const id = randomUUID()
    const createdAt = input.createdAt ?? new Date()
    const deposit: Deposit = { id, createdAt, ...input }
    this.deposits.set(id, deposit)
    const canonical = `${input.externalRefSource}:${input.externalRef}`
    this.byCanonical.set(canonical, id)
    this.byProviderRef.set(canonical, id)
    return deposit
  }

  // Compatibility helpers expected by CI code
  async create(input: Omit<Deposit, 'id' | 'createdAt' | 'status'> & { status?: DepositStatus }): Promise<Deposit> {
    return this.add({ ...input, status: input.status ?? 'unmatched' })
  }

  async confirm(depositId: string): Promise<Deposit | null> {
    const d = this.deposits.get(depositId)
    if (!d) return null
    d.status = 'matched'
    d.matchedAt = new Date()
    this.deposits.set(depositId, d)
    return d
  }

  async attachExternalRef(depositId: string, source: string, ref: string): Promise<Deposit | null> {
    const d = this.deposits.get(depositId)
    if (!d) return null
    d.externalRefSource = source
    d.externalRef = ref
    const canonical = `${source}:${ref}`
    this.byCanonical.set(canonical, depositId)
    this.byProviderRef.set(canonical, depositId)
    this.deposits.set(depositId, d)
    return d
  }

  async getById(depositId: string): Promise<Deposit | null> {
    return this.deposits.get(depositId) ?? null
  }

  async getByCanonical(canonical: string): Promise<Deposit | null> {
    const id = this.byCanonical.get(canonical)
    return id ? (this.deposits.get(id) ?? null) : null
  }

  async getByProviderRef(source: string, ref: string): Promise<Deposit | null> {
    const canonical = `${source}:${ref}`
    return this.getByCanonical(canonical)
  }

  async reverseByCanonical(canonical: string): Promise<Deposit | null> {
    const dep = await this.getByCanonical(canonical)
    if (!dep) return null
    dep.status = 'reversed'
    dep.reversalId = `rev-${dep.id}`
    this.deposits.set(dep.id, dep)
    return dep
  }

  async confirmByCanonical(canonical: string): Promise<Deposit | null> {
    const dep = await this.getByCanonical(canonical)
    if (!dep) return null
    dep.status = 'matched'
    dep.matchedAt = new Date()
    this.deposits.set(dep.id, dep)
    return dep
  }

  async markConsumed(depositId: string): Promise<void> {
    this.consumed.add(depositId)
  }

  async getByConversionId(_conversionId: string): Promise<Deposit | null> {
    // Not tracked in MVP; return null for compatibility
    return null
  }

  async fail(canonical: string, _reason?: string): Promise<Deposit | null> {
    // Keep as unmatched but return record for compatibility
    return this.getByCanonical(canonical)
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
    this.byCanonical.clear()
    this.byProviderRef.clear()
    this.consumed.clear()
  }
}

export const depositStore = new DepositStore()
