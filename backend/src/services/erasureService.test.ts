import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  cancelErasure,
  confirmErasure,
  getErasure,
  processDueErasures,
  requestErasure,
} from './erasureService.js'
import { findErasureBlockers, type ErasureBlocker } from './erasureGuards.js'
import { userStore } from '../models/authStore.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

vi.mock('./erasureGuards.js', () => ({
  findErasureBlockers: vi.fn(async () => []),
}))

vi.mock('../models/authStore.js', () => ({
  userStore: {
    getById: vi.fn(async (id: string) => ({ id, email: `${id}@example.test` })),
    revokeAllSessions: vi.fn(async () => 1),
    anonymize: vi.fn(async () => undefined),
  },
}))

vi.mock('../utils/auditLogger.js', () => ({
  auditLog: vi.fn(),
}))

const DAY = 24 * 60 * 60 * 1000
const T0 = new Date('2026-11-23T10:00:00Z')

function auditFor(userId: string) {
  return { userId, requestId: randomUUID(), ip: '127.0.0.1', actorType: 'user' as const }
}

async function expectAppError(promise: Promise<unknown>, status: number, code?: string) {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to fail')
    },
    (err: unknown) => err,
  )
  expect(error).toBeInstanceOf(AppError)
  expect((error as AppError).status).toBe(status)
  if (code) expect((error as AppError).code).toBe(code)
  return error as AppError
}

describe('account erasure (#2053)', () => {
  beforeEach(() => {
    vi.mocked(findErasureBlockers).mockImplementation(async () => [])
    vi.mocked(userStore.anonymize).mockClear()
    vi.mocked(userStore.revokeAllSessions).mockClear()
  })

  it('creates one pending request with a 30-day confirmation window', async () => {
    const userId = randomUUID()
    const view = await requestErasure(userId, auditFor(userId), T0)

    expect(view.status).toBe('pending')
    expect(view.canCancel).toBe(true)
    expect(new Date(view.confirmBy).getTime()).toBe(T0.getTime() + 30 * DAY)

    await expectAppError(requestErasure(userId, auditFor(userId), T0), 409, ErrorCode.CONFLICT)
  })

  it('refuses a request while the account is blocked, and names the blockers', async () => {
    const userId = randomUUID()
    vi.mocked(findErasureBlockers).mockImplementation(async (id): Promise<ErasureBlocker[]> =>
      id === userId ? ['active_deal', 'wallet_balance'] : [],
    )

    const error = await expectAppError(requestErasure(userId, auditFor(userId), T0), 409, ErrorCode.CONFLICT)
    expect(error.details).toEqual({ blockers: ['active_deal', 'wallet_balance'] })
    expect(await getErasure(userId, T0)).toBeNull()
  })

  it('schedules the erasure on confirmation, and only the owner can confirm', async () => {
    const userId = randomUUID()
    const created = await requestErasure(userId, auditFor(userId), T0)

    await expectAppError(confirmErasure(randomUUID(), created.id, auditFor(randomUUID()), T0), 404, ErrorCode.NOT_FOUND)

    const scheduled = await confirmErasure(userId, created.id, auditFor(userId), T0)
    expect(scheduled.status).toBe('scheduled')
    expect(new Date(scheduled.graceEndsAt as string).getTime()).toBe(T0.getTime() + 14 * DAY)
    expect(scheduled.canCancel).toBe(true)
  })

  it('does not confirm a request after its confirmation window has passed', async () => {
    const userId = randomUUID()
    const created = await requestErasure(userId, auditFor(userId), T0)
    const late = new Date(T0.getTime() + 31 * DAY)

    await expectAppError(confirmErasure(userId, created.id, auditFor(userId), late), 409)
    expect((await getErasure(userId, late))?.status).toBe('expired')
  })

  it('cancels during the grace window, and refuses once the window has ended', async () => {
    const cancellable = randomUUID()
    const created = await requestErasure(cancellable, auditFor(cancellable), T0)
    await confirmErasure(cancellable, created.id, auditFor(cancellable), T0)
    const cancelled = await cancelErasure(cancellable, auditFor(cancellable), new Date(T0.getTime() + DAY))
    expect(cancelled.status).toBe('cancelled')

    const tooLate = randomUUID()
    const createdLate = await requestErasure(tooLate, auditFor(tooLate), T0)
    await confirmErasure(tooLate, createdLate.id, auditFor(tooLate), T0)
    await expectAppError(
      cancelErasure(tooLate, auditFor(tooLate), new Date(T0.getTime() + 15 * DAY)),
      409,
      ErrorCode.INVALID_STATE_TRANSITION,
    )
  })

  it('anonymizes the account and revokes its sessions once the grace window has ended', async () => {
    const userId = randomUUID()
    const created = await requestErasure(userId, auditFor(userId), T0)
    await confirmErasure(userId, created.id, auditFor(userId), T0)

    const summary = await processDueErasures(new Date(T0.getTime() + 15 * DAY))

    expect(summary.completed).toBeGreaterThanOrEqual(1)
    expect(userStore.revokeAllSessions).toHaveBeenCalledWith(userId, `${userId}@example.test`)
    expect(userStore.anonymize).toHaveBeenCalledWith(userId, `erased+${userId}@erased.invalid`)
    expect((await getErasure(userId, new Date(T0.getTime() + 15 * DAY)))?.status).toBe('completed')
  })

  it('cancels instead of anonymizing when a blocker appears before completion', async () => {
    const userId = randomUUID()
    const created = await requestErasure(userId, auditFor(userId), T0)
    await confirmErasure(userId, created.id, auditFor(userId), T0)

    vi.mocked(findErasureBlockers).mockImplementation(async (id): Promise<ErasureBlocker[]> =>
      id === userId ? ['open_dispute'] : [],
    )
    const completionTime = new Date(T0.getTime() + 15 * DAY)
    await processDueErasures(completionTime)

    expect(userStore.anonymize).not.toHaveBeenCalledWith(userId, expect.anything())
    expect((await getErasure(userId, completionTime))?.status).toBe('cancelled')
  })
})
