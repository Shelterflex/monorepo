import type { User } from '../repositories/AuthRepository.js'

export type UserTier = 'free' | 'pro' | 'enterprise'

export interface TierLimits {
    requestsPerMinute: number
    requestsPerDay: number
}

const TIER_LIMITS: Record<UserTier, TierLimits> = {
    free: {
        requestsPerMinute: 60,
        requestsPerDay: 1000,
    },
    pro: {
        requestsPerMinute: 300,
        requestsPerDay: 50000,
    },
    enterprise: {
        requestsPerMinute: 1000,
        requestsPerDay: 500000,
    },
}

export class QuotaService {
    async getUserLimits(user?: User): Promise<TierLimits> {
        if (!user) {
            // Default limits for unauthenticated users (IP-based)
            return TIER_LIMITS.free
        }

        const tier = user.tier || 'free'
        const limits = { ...TIER_LIMITS[tier] }

        // If user has a custom quota in DB, use it for daily limit
        if (user.planQuota) {
            limits.requestsPerDay = user.planQuota
        }

        return limits
    }

    getTiers(): UserTier[] {
        return ['free', 'pro', 'enterprise']
    }
}

export const quotaService = new QuotaService()
