import { describe, it, expect } from 'vitest'
import { QuotaService } from './QuotaService.js'
import type { User } from '../repositories/AuthRepository.js'

describe('QuotaService', () => {
    const service = new QuotaService()

    it('should return free limits for anonymous users', async () => {
        const limits = await service.getUserLimits(undefined)
        expect(limits.requestsPerMinute).toBe(60)
        expect(limits.requestsPerDay).toBe(1000)
    })

    it('should return pro limits for pro users', async () => {
        const user = { tier: 'pro' } as User
        const limits = await service.getUserLimits(user)
        expect(limits.requestsPerMinute).toBe(300)
        expect(limits.requestsPerDay).toBe(50000)
    })

    it('should respect custom plan_quota', async () => {
        const user = { tier: 'pro', planQuota: 100000 } as any
        const limits = await service.getUserLimits(user)
        expect(limits.requestsPerDay).toBe(100000)
    })

    it('should default to free if tier is missing', async () => {
        const user = {} as User
        const limits = await service.getUserLimits(user)
        expect(limits.requestsPerMinute).toBe(60)
    })
})
