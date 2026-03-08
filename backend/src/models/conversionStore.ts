import { randomUUID } from 'node:crypto'
import type { Conversion, ConversionStatus } from './conversion.js'

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

class ConversionStore {
  private conversions = new Map<string, Conversion>()

  async add(input: Omit<Conversion, 'id' | 'createdAt' | 'updatedAt'> & { createdAt?: Date; updatedAt?: Date }): Promise<Conversion> {
    const id = randomUUID()
    const now = new Date()
    const createdAt = input.createdAt ?? now
    const updatedAt = input.updatedAt ?? now
    const conv: Conversion = { id, createdAt, updatedAt, ...input }
    this.conversions.set(id, conv)
    return conv
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
  }
}

export const conversionStore = new ConversionStore()

