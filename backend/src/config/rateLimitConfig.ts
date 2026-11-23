export interface RateLimiterOptions {
  /** Max requests allowed within the window */
  points: number
  /** Window duration in seconds */
  duration: number
  /** Redis key prefix to namespace this limiter */
  keyPrefix: string
  /** Key to use for identification: 'ip' uses req.ip, 'user' uses JWT sub claim (falls back to ip) */
  keyBy: 'ip' | 'user'
}

export const rateLimitProfiles = {
  auth: {
    points: 10,
    duration: 15 * 60, // 15 minutes
    keyPrefix: 'rl:auth',
    keyBy: 'ip',
  },
  otp: {
    points: 5,
    duration: 10 * 60, // 10 minutes
    keyPrefix: 'rl:otp',
    keyBy: 'ip',
  },
  publicSearch: {
    points: 60,
    duration: 60, // 1 minute
    keyPrefix: 'rl:public_search',
    keyBy: 'ip',
  },
  partnerApplication: {
    points: 5,
    duration: 60 * 60, // 1 hour
    keyPrefix: 'rl:partner_application',
    keyBy: 'ip',
  },
  authenticated: {
    points: 300,
    duration: 60, // 1 minute
    keyPrefix: 'rl:authed',
    keyBy: 'user',
  },
  adminBulk: {
    points: 20,
    duration: 60, // 1 minute
    keyPrefix: 'rl:admin_bulk',
    keyBy: 'user',
  },
  messaging: {
    points: 30,
    duration: 60, // 1 minute
    keyPrefix: 'rl:messaging',
    keyBy: 'user',
  },
  // Public tenant rating card share links (#1905): unauthenticated, so limited per IP.
  publicRatingCard: {
    points: 30,
    duration: 60, // 1 minute
    keyPrefix: 'rl:public_rating_card',
    keyBy: 'ip',
  },
  // Public contact-form submissions (#2056): five per hour per IP.
  supportMessage: {
    points: 5,
    duration: 60 * 60, // 1 hour
    keyPrefix: 'rl:support_message',
    keyBy: 'ip',
  },
} as const satisfies Record<string, RateLimiterOptions>

export type RateLimitProfileName = keyof typeof rateLimitProfiles
