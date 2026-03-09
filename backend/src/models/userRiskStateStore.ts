import {
  UserRiskState,
  CreateUserRiskStateInput,
  UpdateUserRiskStateInput,
  UserRiskStateStore,
  FreezeReason,
} from './userRiskState.js'

/**
 * In-memory implementation of UserRiskStateStore for MVP development
 * In production, this should be replaced with a database implementation
 */
export class InMemoryUserRiskStateStore implements UserRiskStateStore {
  private riskStates: Map<string, UserRiskState> = new Map()

  async create(input: CreateUserRiskStateInput): Promise<UserRiskState> {
    const existing = this.riskStates.get(input.userId)
    if (existing) {
      throw new Error(`Risk state already exists for user ${input.userId}`)
    }

    const now = new Date()
    const riskState: UserRiskState = {
      userId: input.userId,
      isFrozen: input.isFrozen,
      freezeReason: input.freezeReason,
      frozenAt: input.isFrozen ? now : null,
      unfrozenAt: null,
      notes: input.notes || null,
      createdAt: now,
      updatedAt: now,
    }

    this.riskStates.set(input.userId, riskState)
    return riskState
  }

  async getByUserId(userId: string): Promise<UserRiskState | null> {
    return this.riskStates.get(userId) || null
  }

  async update(userId: string, input: UpdateUserRiskStateInput): Promise<UserRiskState> {
    const existing = this.riskStates.get(userId)
    if (!existing) {
      throw new Error(`Risk state not found for user ${userId}`)
    }

    const now = new Date()
    const updated: UserRiskState = {
      ...existing,
      isFrozen: input.isFrozen,
      freezeReason: input.freezeReason,
      frozenAt: input.isFrozen && !existing.isFrozen ? now : existing.frozenAt,
      unfrozenAt: !input.isFrozen && existing.isFrozen ? now : existing.unfrozenAt,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      updatedAt: now,
    }

    this.riskStates.set(userId, updated)
    return updated
  }

  async freeze(userId: string, reason: FreezeReason, notes?: string): Promise<UserRiskState> {
    const existing = await this.getByUserId(userId)
    
    if (existing) {
      return this.update(userId, {
        isFrozen: true,
        freezeReason: reason,
        notes: notes || existing.notes,
      })
    }

    return this.create({
      userId,
      isFrozen: true,
      freezeReason: reason,
      notes,
    })
  }

  async unfreeze(userId: string, notes?: string): Promise<UserRiskState> {
    const existing = await this.getByUserId(userId)
    if (!existing) {
      throw new Error(`Risk state not found for user ${userId}`)
    }

    return this.update(userId, {
      isFrozen: false,
      freezeReason: null,
      notes: notes || existing.notes,
    })
  }

  async getAllFrozen(): Promise<UserRiskState[]> {
    return Array.from(this.riskStates.values()).filter((state) => state.isFrozen)
  }

  // Helper method for testing/cleanup
  clear(): void {
    this.riskStates.clear()
  }

  // Helper method to get all risk states (for testing)
  getAll(): UserRiskState[] {
    return Array.from(this.riskStates.values())
  }
}

export const userRiskStateStore = new InMemoryUserRiskStateStore()
