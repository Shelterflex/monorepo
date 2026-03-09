import { randomUUID } from 'node:crypto'
import {
  Deposit,
  DepositStatus,
  CreateDepositInput,
  type DepositRecord,
  type ConfirmDepositRecordInput,
} from './deposit.js'

class DepositStore {
  // Initiation (pending deposits tracked by external refs)
  private initiationsById = new Map<string, Deposit>()
  private byCanonicalRef = new Map<string, string>()

  // Confirmed deposits (idempotent by depositId)
  private deposits = new Map<string, DepositRecord>()

  // Initiation flow
  async create(input: CreateDepositInput): Promise<Deposit> {
    const now = new Date()
    const deposit: Deposit = {
      depositId: randomUUID(),
      quoteId: input.quoteId,
      userId: input.userId,
      paymentRail: input.paymentRail,
      amountNgn: input.amountNgn,
      status: DepositStatus.PENDING,
      customerMeta: input.customerMeta,
      createdAt: now,
      updatedAt: now,
    }
    this.initiationsById.set(deposit.depositId, deposit)
    return deposit
  }

  async attachExternalRef(
    depositId: string,
    externalRefSource: string,
    externalRef: string,
  ): Promise<Deposit | null> {
    const deposit = this.initiationsById.get(depositId)
    if (!deposit) return null
    deposit.externalRefSource = externalRefSource
    deposit.externalRef = externalRef
    deposit.updatedAt = new Date()
    const canonical = `${externalRefSource}:${externalRef}`
    this.byCanonicalRef.set(canonical, depositId)
    this.initiationsById.set(depositId, deposit)
    return deposit
  }

  async getByCanonical(rail: string, externalRef: string): Promise<Deposit | null> {
    const id = this.byCanonicalRef.get(`${rail}:${externalRef}`)
    if (!id) return null
    return this.initiationsById.get(id) ?? null
  }

  async confirmByCanonical(rail: string, externalRef: string): Promise<Deposit | null> {
    const deposit = await this.getByCanonical(rail, externalRef)
    if (!deposit) return null
    if (deposit.status === DepositStatus.CONFIRMED) return deposit
    deposit.status = DepositStatus.CONFIRMED
    deposit.confirmedAt = new Date()
    deposit.updatedAt = new Date()
    this.initiationsById.set(deposit.depositId, deposit)
    return deposit
  }

  async fail(depositId: string): Promise<Deposit | null> {
    const deposit = this.initiationsById.get(depositId)
    if (!deposit) return null
    deposit.status = DepositStatus.FAILED
    deposit.updatedAt = new Date()
    this.initiationsById.set(depositId, deposit)
    return deposit
  }

  async reverseByCanonical(rail: string, externalRef: string): Promise<Deposit | null> {
    const deposit = await this.getByCanonical(rail, externalRef)
    if (!deposit) return null
    if (deposit.status === DepositStatus.REVERSED) return deposit
    deposit.status = DepositStatus.REVERSED
    deposit.updatedAt = new Date()
    this.initiationsById.set(deposit.depositId, deposit)
    return deposit
  }

  // Confirmed deposit flow
  async confirm(input: ConfirmDepositRecordInput): Promise<DepositRecord> {
    const existing = this.deposits.get(input.depositId)
    if (existing) {
      return existing
    }

    const now = new Date()
    const record: DepositRecord = {
      depositId: input.depositId,
      userId: input.userId,
      amountNgn: input.amountNgn,
      provider: input.provider,
      providerRef: input.providerRef,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
      consumedAt: null,
      reversedAt: null,
      reversalRef: null,
    }

    this.deposits.set(input.depositId, record)
    return record
  }

  async getById(depositId: string): Promise<DepositRecord | null> {
    return this.deposits.get(depositId) ?? null
  }

  async markConsumed(depositId: string): Promise<DepositRecord | null> {
    const dep = this.deposits.get(depositId)
    if (!dep) return null
    if (dep.status === 'consumed') {
      return dep
    }
    const now = new Date()
    const updated: DepositRecord = {
      ...dep,
      status: 'consumed',
      consumedAt: now,
      updatedAt: now,
    }
    this.deposits.set(depositId, updated)
    return updated
  }

  async markReversed(depositId: string, reversalRef: string): Promise<DepositRecord | null> {
    const dep = this.deposits.get(depositId)
    if (!dep) return null
    
    // Idempotent - if already reversed, return existing
    if (dep.reversedAt) {
      return dep
    }

    const now = new Date()
    const updated: DepositRecord = {
      ...dep,
      reversedAt: now,
      reversalRef,
      updatedAt: now,
    }
    this.deposits.set(depositId, updated)
    return updated
  }

  async getByProviderRef(provider: string, providerRef: string): Promise<DepositRecord | null> {
    for (const dep of this.deposits.values()) {
      if (dep.provider === provider && dep.providerRef === providerRef) {
        return dep
      }
    }
    return null
  }

  async clear(): Promise<void> {
    this.initiationsById.clear()
    this.byCanonicalRef.clear()
    this.deposits.clear()
  }
}

export const depositStore = new DepositStore()
