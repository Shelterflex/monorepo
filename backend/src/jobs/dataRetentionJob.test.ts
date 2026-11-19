import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runDataRetention } from './dataRetentionJob.js'

const mockQuery = vi.fn()

vi.mock('../db.js', () => ({
  getPool: vi.fn(async () => ({
    query: mockQuery,
  })),
}))

describe('DataRetentionJob', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockQuery
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: '1' }, { id: '2' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'k1' }] })
      .mockResolvedValueOnce({ rowCount: 3, rows: [{ message_id: 'm1' }] })
  })

  it('deletes onboarding drafts older than 6 months with no submission', async () => {
    const now = new Date('2026-06-01T12:00:00.000Z')
    const result = await runDataRetention(now)

    expect(result.onboardingDraftsDeleted).toBe(2)
    expect(result.kycRejectionsAnonymised).toBe(1)
    expect(result.supportMessagesDeleted).toBe(3)

    const draftCall = mockQuery.mock.calls[0]
    expect(draftCall[0]).toContain('onboarding_drafts')
    expect(draftCall[0]).toContain('submitted = FALSE')

    const sixMonthsAgo = draftCall[1][0] as Date
    const diffDays = (now.getTime() - sixMonthsAgo.getTime()) / (24 * 60 * 60 * 1000)
    expect(diffDays).toBeGreaterThanOrEqual(179)
    expect(diffDays).toBeLessThanOrEqual(181)
  })
})
