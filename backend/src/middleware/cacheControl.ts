import { Request, Response, NextFunction } from 'express'
import { AuthenticatedRequest } from './auth.js'
import { meter } from '../utils/metrics.js'

/**
 * Cache configuration for endpoints
 */
export interface CacheConfig {
  /** Time-to-live in seconds for public cache (CDN) */
  publicTtl?: number
  /** Time-to-live in seconds for private cache (browser) */
  privateTtl?: number
  /** Whether to use shared cache (CDN) or only private cache */
  shared?: boolean
  /** Whether this endpoint requires authentication */
  requiresAuth?: boolean
  /** Cache key template for invalidation */
  cacheKey?: string
  /** Tags for selective invalidation */
  tags?: string[]
  /** Whether to vary cache by user */
  varyByUser?: boolean
  /** Whether to bypass cache for specific user roles */
  bypassForRoles?: ('tenant' | 'landlord' | 'agent')[]
}

/**
 * Predefined cache configurations for common endpoint patterns
 */
export const CachePresets: Record<string, CacheConfig> = {
  // Public data that changes rarely
  static: {
    publicTtl: 3600, // 1 hour
    privateTtl: 86400, // 24 hours
    shared: true,
    requiresAuth: false,
  },

  // Public data that changes frequently
  dynamic: {
    publicTtl: 60, // 1 minute
    privateTtl: 300, // 5 minutes
    shared: true,
    requiresAuth: false,
  },

  // User-specific data that changes rarely
  userStatic: {
    publicTtl: 0,
    privateTtl: 3600, // 1 hour
    shared: false,
    requiresAuth: true,
    varyByUser: true,
  },

  // User-specific data that changes frequently
  userDynamic: {
    publicTtl: 0,
    privateTtl: 60, // 1 minute
    shared: false,
    requiresAuth: true,
    varyByUser: true,
  },

  // Admin data - never cache
  admin: {
    publicTtl: 0,
    privateTtl: 0,
    shared: false,
    requiresAuth: true,
    bypassForRoles: ['landlord', 'agent', 'tenant'],
  },

  // No caching
  noCache: {
    publicTtl: 0,
    privateTtl: 0,
    shared: false,
  },
}

/**
 * Per-endpoint cache configuration registry
 */
const endpointCacheConfigs = new Map<string, CacheConfig>()

/**
 * Register cache configuration for an endpoint
 */
export function registerEndpointCache(route: string, config: CacheConfig): void {
  endpointCacheConfigs.set(route, config)
}

/**
 * Get cache configuration for an endpoint
 */
export function getEndpointCache(route: string): CacheConfig | undefined {
  return endpointCacheConfigs.get(route)
}

/**
 * Build Cache-Control header based on configuration
 */
function buildCacheControlHeader(config: CacheConfig, req: Request): string {
  const directives: string[] = []

  // Check if we should bypass cache for this user
  if (config.bypassForRoles && (req as AuthenticatedRequest).user) {
    const userRole = (req as AuthenticatedRequest).user?.role
    if (userRole && config.bypassForRoles.includes(userRole)) {
      directives.push('no-store', 'no-cache', 'must-revalidate')
      return directives.join(', ')
    }
  }

  // Private user data should never be in shared caches
  if (!config.shared) {
    directives.push('private')
  }

  // Add public directive if shared cache is allowed
  if (config.shared) {
    directives.push('public')
  }

  // Add max-age for public cache
  if (config.publicTtl && config.publicTtl > 0) {
    directives.push(`max-age=${config.publicTtl}`)
  }

  // Add max-age for private cache (s-maxage for shared, max-age for private)
  if (config.privateTtl && config.privateTtl > 0) {
    if (config.shared) {
      directives.push(`s-maxage=${config.publicTtl || 0}`)
    }
    directives.push(`max-age=${config.privateTtl}`)
  }

  // Add no-cache if no TTL
  if (!config.publicTtl && !config.privateTtl) {
    directives.push('no-store', 'no-cache', 'must-revalidate')
  }

  // Add revalidation directives
  if (config.publicTtl && config.publicTtl > 0) {
    directives.push('stale-while-revalidate=30', 'stale-if-error=60')
  }

  return directives.join(', ')
}

/**
 * Add Vary header for user-specific caching
 */
function buildVaryHeader(config: CacheConfig): string | null {
  if (config.varyByUser) {
    return 'Authorization, Cookie'
  }
  return null
}

/**
 * Cache metrics
 */
const cacheMetrics = {
  hits: meter.createCounter('cache_hits_total', {
    description: 'Total number of cache hits',
  }),
  misses: meter.createCounter('cache_misses_total', {
    description: 'Total number of cache misses',
  }),
  bypasses: meter.createCounter('cache_bypasses_total', {
    description: 'Total number of cache bypasses',
  }),
  invalidations: meter.createCounter('cache_invalidations_total', {
    description: 'Total number of cache invalidations',
  }),
}

/**
 * Middleware to apply cache-control headers based on endpoint configuration
 */
export function cacheControl(config: CacheConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Store config for later use
    ;(req as any).cacheConfig = config

    // Apply cache control headers
    const cacheControl = buildCacheControlHeader(config, req)
    res.setHeader('Cache-Control', cacheControl)

    // Add Vary header if needed
    const varyHeader = buildVaryHeader(config)
    if (varyHeader) {
      res.setHeader('Vary', varyHeader)
    }

    // Add cache tags for invalidation
    if (config.tags && config.tags.length > 0) {
      res.setHeader('X-Cache-Tags', config.tags.join(','))
    }

    // Add cache key if specified
    if (config.cacheKey) {
      res.setHeader('X-Cache-Key', config.cacheKey)
    }

    // Track cache bypass
    if (config.bypassForRoles && (req as AuthenticatedRequest).user) {
      const userRole = (req as AuthenticatedRequest).user?.role
      if (userRole && config.bypassForRoles.includes(userRole)) {
        cacheMetrics.bypasses.add(1, {
          route: req.route?.path || req.path,
          role: userRole,
        })
      }
    }

    next()
  }
}

/**
 * Get cache configuration from request
 */
export function getRequestCacheConfig(req: Request): CacheConfig | undefined {
  return (req as any).cacheConfig
}

/**
 * Check if request should bypass cache
 */
export function shouldBypassCache(req: Request): boolean {
  const config = getRequestCacheConfig(req)
  if (!config) return true

  if (config.bypassForRoles && (req as AuthenticatedRequest).user) {
    const userRole = (req as AuthenticatedRequest).user?.role
    if (userRole && config.bypassForRoles.includes(userRole)) {
      return true
    }
  }

  return false
}

/**
 * Record cache hit/miss metrics
 */
export function recordCacheHit(route: string, layer: 'l1' | 'l2'): void {
  cacheMetrics.hits.add(1, { route, layer })
}

export function recordCacheMiss(route: string): void {
  cacheMetrics.misses.add(1, { route })
}

/**
 * Record cache invalidation
 */
export function recordCacheInvalidation(tags: string[]): void {
  cacheMetrics.invalidations.add(1, { tags: tags.join(',') })
}
