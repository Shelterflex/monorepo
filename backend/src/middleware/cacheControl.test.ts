import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Request, Response, NextFunction } from 'express'
import {
  cacheControl,
  CachePresets,
  registerEndpointCache,
  getEndpointCache,
  getRequestCacheConfig,
  shouldBypassCache,
  recordCacheHit,
  recordCacheMiss,
  type CacheConfig,
} from './cacheControl.js'
import { AuthenticatedRequest } from './auth.js'
import { meter } from '../utils/metrics.js'

// Mock metrics
vi.mock('../utils/metrics.js', () => ({
  meter: {
    createCounter: vi.fn(() => ({
      add: vi.fn(),
    })),
  },
}))

describe('Cache Control Middleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction

  beforeEach(() => {
    mockReq = {
      path: '/test',
      route: { path: '/test' },
    }
    mockRes = {
      setHeader: vi.fn(),
    }
    mockNext = vi.fn()
  })

  describe('Cache Presets', () => {
    it('should have static preset with long TTL', () => {
      expect(CachePresets.static.publicTtl).toBe(3600)
      expect(CachePresets.static.privateTtl).toBe(86400)
      expect(CachePresets.static.shared).toBe(true)
    })

    it('should have dynamic preset with short TTL', () => {
      expect(CachePresets.dynamic.publicTtl).toBe(60)
      expect(CachePresets.dynamic.privateTtl).toBe(300)
      expect(CachePresets.dynamic.shared).toBe(true)
    })

    it('should have userStatic preset with private cache only', () => {
      expect(CachePresets.userStatic.publicTtl).toBe(0)
      expect(CachePresets.userStatic.privateTtl).toBe(3600)
      expect(CachePresets.userStatic.shared).toBe(false)
      expect(CachePresets.userStatic.varyByUser).toBe(true)
    })

    it('should have noCache preset with no caching', () => {
      expect(CachePresets.noCache.publicTtl).toBe(0)
      expect(CachePresets.noCache.privateTtl).toBe(0)
      expect(CachePresets.noCache.shared).toBe(false)
    })
  })

  describe('Endpoint Cache Registration', () => {
    it('should register cache configuration for an endpoint', () => {
      const config: CacheConfig = {
        publicTtl: 300,
        privateTtl: 600,
        shared: true,
      }

      registerEndpointCache('/test', config)

      const retrieved = getEndpointCache('/test')
      expect(retrieved).toEqual(config)
    })

    it('should return undefined for unregistered endpoint', () => {
      const retrieved = getEndpointCache('/nonexistent')
      expect(retrieved).toBeUndefined()
    })

    it('should overwrite existing configuration', () => {
      registerEndpointCache('/test', { publicTtl: 100 })
      registerEndpointCache('/test', { publicTtl: 200 })

      const retrieved = getEndpointCache('/test')
      expect(retrieved?.publicTtl).toBe(200)
    })
  })

  describe('Cache Control Middleware', () => {
    it('should set Cache-Control header for static preset', () => {
      const middleware = cacheControl(CachePresets.static)
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        expect.stringContaining('public')
      )
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        expect.stringContaining('max-age=3600')
      )
      expect(mockNext).toHaveBeenCalled()
    })

    it('should set Cache-Control header for no-cache preset', () => {
      const middleware = cacheControl(CachePresets.noCache)
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        expect.stringContaining('no-store')
      )
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        expect.stringContaining('no-cache')
      )
    })

    it('should set private directive for user-specific data', () => {
      const middleware = cacheControl(CachePresets.userStatic)
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        expect.stringContaining('private')
      )
    })

    it('should set Vary header for user-specific caching', () => {
      const middleware = cacheControl(CachePresets.userStatic)
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.setHeader).toHaveBeenCalledWith('Vary', 'Authorization, Cookie')
    })

    it('should set X-Cache-Tags header when tags are provided', () => {
      const config: CacheConfig = {
        ...CachePresets.static,
        tags: ['property', 'listings'],
      }
      const middleware = cacheControl(config)
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Cache-Tags', 'property,listings')
    })

    it('should set X-Cache-Key header when cacheKey is provided', () => {
      const config: CacheConfig = {
        ...CachePresets.static,
        cacheKey: 'property:123',
      }
      const middleware = cacheControl(config)
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Cache-Key', 'property:123')
    })

    it('should include stale-while-revalidate and stale-if-error', () => {
      const middleware = cacheControl(CachePresets.static)
      middleware(mockReq as Request, mockRes as Response, mockNext)

      const cacheControlCall = (mockRes.setHeader as any).mock.calls.find(
        (call: any[]) => call[0] === 'Cache-Control'
      )
      expect(cacheControlCall[1]).toContain('stale-while-revalidate=30')
      expect(cacheControlCall[1]).toContain('stale-if-error=60')
    })
  })

  describe('Permission-based Cache Bypass', () => {
    it('should bypass cache for specified user roles', () => {
      const config: CacheConfig = {
        ...CachePresets.static,
        bypassForRoles: ['landlord'],
      }
      const authReq = mockReq as AuthenticatedRequest
      authReq.user = { id: '1', email: 'test@test.com', name: 'Test', role: 'landlord' }

      const middleware = cacheControl(config)
      middleware(authReq as Request, mockRes as Response, mockNext)

      const cacheControlCall = (mockRes.setHeader as any).mock.calls.find(
        (call: any[]) => call[0] === 'Cache-Control'
      )
      expect(cacheControlCall[1]).toContain('no-store')
      expect(cacheControlCall[1]).toContain('no-cache')
    })

    it('should not bypass cache for non-specified roles', () => {
      const config: CacheConfig = {
        ...CachePresets.static,
        bypassForRoles: ['admin'],
      }
      const authReq = mockReq as AuthenticatedRequest
      authReq.user = { id: '1', email: 'test@test.com', name: 'Test', role: 'landlord' }

      const middleware = cacheControl(config)
      middleware(authReq as Request, mockRes as Response, mockNext)

      const cacheControlCall = (mockRes.setHeader as any).mock.calls.find(
        (call: any[]) => call[0] === 'Cache-Control'
      )
      expect(cacheControlCall[1]).not.toContain('no-store')
    })

    it('should not bypass cache when user is not authenticated', () => {
      const config: CacheConfig = {
        ...CachePresets.static,
        bypassForRoles: ['landlord'],
      }

      const middleware = cacheControl(config)
      middleware(mockReq as Request, mockRes as Response, mockNext)

      const cacheControlCall = (mockRes.setHeader as any).mock.calls.find(
        (call: any[]) => call[0] === 'Cache-Control'
      )
      expect(cacheControlCall[1]).not.toContain('no-store')
    })
  })

  describe('Request Cache Config', () => {
    it('should store cache config on request', () => {
      const config: CacheConfig = { publicTtl: 300 }
      const middleware = cacheControl(config)
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(getRequestCacheConfig(mockReq as Request)).toEqual(config)
    })

    it('should return undefined when no config is set', () => {
      expect(getRequestCacheConfig(mockReq as Request)).toBeUndefined()
    })
  })

  describe('Cache Bypass Logic', () => {
    it('should return true when no config is set', () => {
      expect(shouldBypassCache(mockReq as Request)).toBe(true)
    })

    it('should return true when user role is in bypass list', () => {
      const config: CacheConfig = {
        ...CachePresets.static,
        bypassForRoles: ['landlord'],
      }
      const authReq = mockReq as AuthenticatedRequest
      authReq.user = { id: '1', email: 'test@test.com', name: 'Test', role: 'landlord' }
      ;(authReq as any).cacheConfig = config

      expect(shouldBypassCache(authReq as Request)).toBe(true)
    })

    it('should return false when user role is not in bypass list', () => {
      const config: CacheConfig = {
        ...CachePresets.static,
        bypassForRoles: ['admin'],
      }
      const authReq = mockReq as AuthenticatedRequest
      authReq.user = { id: '1', email: 'test@test.com', name: 'Test', role: 'landlord' }
      ;(authReq as any).cacheConfig = config

      expect(shouldBypassCache(authReq as Request)).toBe(false)
    })
  })

  describe('Cache Metrics', () => {
    it('should record cache hit', () => {
      recordCacheHit('/test', 'l1')
      expect(meter.createCounter).toHaveBeenCalled()
    })

    it('should record cache miss', () => {
      recordCacheMiss('/test')
      expect(meter.createCounter).toHaveBeenCalled()
    })
  })
})
