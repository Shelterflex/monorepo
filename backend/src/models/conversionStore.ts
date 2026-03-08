import { randomUUID } from 'node:crypto'
import type { Conversion, ConversionStatus } from './conversion.js'

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export class ConversionStore {
  private conversions = new Map<string, Conversion>()
  private byDepositId = new Map<string, string>() // depositId -> conversionId
  private byConversionId = new Map<string, string>() // conversionId -> depositId

  async add(input: Omit<Conversion, 'id' | 'createdAt' | 'updatedAt'> & { createdAt?: Date; updatedAt?: Date }): Promise<Conversion> {
    const id = randomUUID()
    const now = new Date()
    const createdAt = input.createdAt ?? now
    const updatedAt = input.updatedAt ?? now
    const conv: Conversion = { id, createdAt, updatedAt, ...input }
    this.conversions.set(id, conv)
    return conv
  }

  // Compatibility helpers expected by CI code
  async createPending(depositId: string, data: Omit<Conversion, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Conversion> {
    const conv = await this.add({ ...data, status: 'pending' })
    this.byDepositId.set(depositId, conv.id)
    this.byConversionId.set(conv.id, depositId)
    return conv
  }

  async markCompleted(conversionId: string): Promise<Conversion | null> {
    const conv = this.conversions.get(conversionId)
    if (!conv) return null
    conv.status = 'completed'
    conv.updatedAt = new Date()
    this.conversions.set(conversionId, conv)
    return conv
  }

  async markFailed(conversionId: string): Promise<Conversion | null> {
    const conv = this.conversions.get(conversionId)
    if (!conv) return null
    conv.status = 'failed'
    conv.updatedAt = new Date()
    this.conversions.set(conversionId, conv)
    return conv
  }

  async getByDepositId(depositId: string): Promise<Conversion | null> {
    const id = this.byDepositId.get(depositId)
    return id ? (this.conversions.get(id) ?? null) : null
  }

  async getById(conversionId: string): Promise<Conversion | null> {
    return this.conversions.get(conversionId) ?? null
  }

  async getByConversionId(conversionId: string): Promise<Conversion | null> {
    return this.getById(conversionId)
  }

  async listCompleted(): Promise<Conversion[]> {
    return Array.from(this.conversions.values()).filter((c) => c.status === 'completed')
  }

  async listByStatus(
    status: ConversionStatus | undefined,
    page = 1,
    pageSize = 20,
  ): Promise<Paginated<Conversion>> {
    const all = Array.from(this.conversions.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )
    const filtered = status ? all.filter((c) => c.status === status) : all
    const total = filtered.length
    const totalPages = Math.ceil(total / pageSize) || 1
    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize)
    return { items, total, page, pageSize, totalPages }
  }

  async clear(): Promise<void> {
    this.conversions.clear()
    this.byDepositId.clear()
    this.byConversionId.clear()
  }
}

export const conversionStore = new ConversionStore()
