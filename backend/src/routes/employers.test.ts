import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { employerStore } from '../models/employerStore.js'
import { dealStore } from '../models/dealStore.js'
import { DealStatus } from '../models/deal.js'
import { applyDealRepaymentMethod } from '../services/salaryDeductionService.js'

const { ADMIN_SECRET } = vi.hoisted(() => ({
  ADMIN_SECRET: 'test-admin-secret-for-employers',
}))

// env.js parses MANUAL_ADMIN_SECRET from process.env once at import time, so
// setting process.env in beforeEach (as this file used to do) has no effect
// on the already-parsed `env` object. Override it directly instead — every
// other env field stays real since this suite boots the full app.
vi.mock('../schemas/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../schemas/env.js')>()
  return {
    ...actual,
    env: { ...actual.env, MANUAL_ADMIN_SECRET: ADMIN_SECRET },
  }
})

describe('Employers API', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    await employerStore.clear()
    await dealStore.clear()
    app = createApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function createActiveEmployer(apiKeyOut?: { key: string }) {
    const createRes = await request(app)
      .post('/api/admin/employers')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({
        name: 'Acme Corp',
        registrationNumber: 'RC-12345',
        contactEmail: 'hr@acme.com',
        contactPhone: '+2348000000000',
        monthlyDeductionWebhookUrl: 'https://payroll.acme.com/webhooks/deductions',
      })
      .expect(201)

    const apiKey = createRes.body.data.apiKey as string
    if (apiKeyOut) apiKeyOut.key = apiKey

    await request(app)
      .patch(`/api/admin/employers/${createRes.body.data.employer.id}/activate`)
      .set('x-admin-secret', ADMIN_SECRET)
      .expect(200)

    return {
      employerId: createRes.body.data.employer.id as string,
      apiKey,
    }
  }

  describe('API key authentication', () => {
    it('rejects missing API key with 401', async () => {
      const { employerId } = await createActiveEmployer()
      await request(app).get(`/api/employers/${employerId}`).expect(401)
    })

    it('rejects invalid API key with 401', async () => {
      const { employerId } = await createActiveEmployer()
      await request(app)
        .get(`/api/employers/${employerId}`)
        .set('x-employer-api-key', 'sk_employer_invalid')
        .expect(401)
    })
  })

  describe('deduction notification matching', () => {
    it('marks the matching instalment as paid', async () => {
      const { employerId, apiKey } = await createActiveEmployer()

      const deal = await dealStore.create({
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        annualRentNgn: 1_200_000,
        depositNgn: 240_000,
        termMonths: 12,
        repaymentMethod: 'salary_deduction',
        employerId,
        employeeId: 'EMP-42',
        deductionDay: 25,
      })

      await applyDealRepaymentMethod(deal.dealId, 'salary_deduction', {
        employerId,
        employeeId: 'EMP-42',
        deductionDay: 25,
      })
      await dealStore.updateStatus(deal.dealId, DealStatus.ACTIVE)

      const due = new Date()
      await dealStore.setScheduleDueDateForTest(
        deal.dealId,
        1,
        due.toISOString(),
      )

      const periodMonth = due.getUTCMonth() + 1
      const periodYear = due.getUTCFullYear()
      const scheduleItem = (await dealStore.findById(deal.dealId))!.schedule[0]

      const notifyRes = await request(app)
        .post('/api/employers/deductions/notify')
        .set('x-employer-api-key', apiKey)
        .send({
          employeeId: 'EMP-42',
          amount: scheduleItem.amountNgn,
          periodMonth,
          periodYear,
          referenceId: 'payroll-ref-001',
        })
        .expect(200)

      expect(notifyRes.body.data).toEqual({
        matched: true,
        dealId: deal.dealId,
        instalmentNumber: 1,
      })

      const updated = await dealStore.findById(deal.dealId)
      expect(updated!.schedule[0].status).toBe('paid')
    })

    it('returns matched false for unknown employeeId without error', async () => {
      const { apiKey } = await createActiveEmployer()

      const res = await request(app)
        .post('/api/employers/deductions/notify')
        .set('x-employer-api-key', apiKey)
        .send({
          employeeId: 'UNKNOWN',
          amount: 50_000,
          periodMonth: 6,
          periodYear: 2026,
          referenceId: 'ref-unknown',
        })
        .expect(200)

      expect(res.body.data).toEqual({ matched: false })
    })
  })

  describe('monthly advance notice job', () => {
    it('sends correct upcoming deduction amounts to employer webhook', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
      vi.stubGlobal('fetch', fetchMock)

      const { employerId } = await createActiveEmployer()

      const deal = await dealStore.create({
        tenantId: 'tenant-1',
        landlordId: 'landlord-1',
        annualRentNgn: 1_200_000,
        depositNgn: 240_000,
        termMonths: 12,
        repaymentMethod: 'salary_deduction',
        employerId,
        employeeId: 'EMP-99',
        deductionDay: 28,
      })

      await dealStore.updateStatus(deal.dealId, DealStatus.ACTIVE)

      const { applyDealRepaymentMethod, sendMonthlyDeductionAdvanceNotices } = await import(
        '../services/salaryDeductionService.js'
      )
      await applyDealRepaymentMethod(deal.dealId, 'salary_deduction', {
        employerId,
        employeeId: 'EMP-99',
        deductionDay: 28,
      })

      const nextMonth = new Date()
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
      await dealStore.setScheduleDueDateForTest(
        deal.dealId,
        1,
        new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), 15)).toISOString(),
      )

      const result = await sendMonthlyDeductionAdvanceNotices(new Date())
      expect(result.employersNotified).toBe(1)
      expect(result.totalDeductions).toBe(1)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string)
      expect(body.event).toBe('salary_deduction.advance_notice')
      expect(body.deductions[0].employeeId).toBe('EMP-99')
      expect(body.deductions[0].deductionAmount).toBe(80_000)
    })
  })
})
