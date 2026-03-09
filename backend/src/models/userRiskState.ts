/**
 * User risk state model for tracking frozen accounts and compliance issues
 */

export type FreezeReason = 'NEGATIVE_BALANCE' | 'MANUAL' | 'COMPLIANCE'

export interface UserRiskState {
  userId: string
  isFrozen: boolean
  freezeReason: FreezeReason | null
  frozenAt: Date | null
  unfrozenAt: Date | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateUserRiskStateInput {
  userId: string
  isFrozen: boolean
  freezeReason: FreezeReason
  notes?: string
}

export interface UpdateUserRiskStateInput {
  isFrozen: boolean
  freezeReason: FreezeReason | null
  notes?: string | null
}

export interface UserRiskStateStore {
  create(input: CreateUserRiskStateInput): Promise<UserRiskState>
  getByUserId(userId: string): Promise<UserRiskState | null>
  update(userId: string, input: UpdateUserRiskStateInput): Promise<UserRiskState>
  freeze(userId: string, reason: FreezeReason, notes?: string): Promise<UserRiskState>
  unfreeze(userId: string, notes?: string): Promise<UserRiskState>
  getAllFrozen(): Promise<UserRiskState[]>
}
