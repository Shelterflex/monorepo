import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runDataRetention } from './dataRetentionJob.js'
import { expireReadyExports } from '../services/tenantDataExportService.js'
import { processDueErasures } from '../services/erasureService.js'

const mockQuery = vi.fn()

vi.mock('../db.js', () => ({
  getPool: vi.fn(async () => ({
    query: mockQuery,
  })),
}))

vi.mock('../services/tenantDataExportService.js', () => ({
  expireReadyExports: vi.fn(async () => 4),
}))

vi.mock('../services/erasureService.js', () => ({
  processDueErasures: vi.fn(async () => ({ completed: 2, cancelledForBlockers: 0, expiredUnconfirmed: 0 })),
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

  it('expires data-export archives and completes due erasures on the same run', async () => {
    const now = new Date('2026-12-10T12:00:00.000Z')
    const result = await runDataRetention(now)

    expect(expireReadyExports).toHaveBeenCalledWith(now)
    expect(processDueErasures).toHaveBeenCalledWith(now)
    expect(result.dataExportsExpired).toBe(4)
    expect(result.erasuresCompleted).toBe(2)
  })

  it('still runs the other steps when the export expiry step fails', async () => {
    vi.mocked(expireReadyExports).mockRejectedValueOnce(new Error('storage unavailable'))
    const result = await runDataRetention(new Date('2026-12-10T12:00:00.000Z'))

    expect(result.dataExportsExpired).toBe(0)
    expect(result.erasuresCompleted).toBe(2)
    expect(result.supportMessagesDeleted).toBe(3)
  })
})
