/**
 * Request sanitization middleware and utilities.
 *
 * Provides comprehensive input sanitization for strings including:
 * - Trimming whitespace
 * - Normalizing Unicode
 * - Removing dangerous patterns
 * - Validating string length
 */

import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'

/**
 * Options for string sanitization.
 */
export interface SanitizationOptions {
  trim?: boolean
  normalize?: boolean
  maxLength?: number
  allowedPatterns?: RegExp[]
  disallowedPatterns?: RegExp[]
}

/**
 * Default sanitization options.
 */
const DEFAULT_SANITIZATION_OPTIONS: SanitizationOptions = {
  trim: true,
  normalize: true,
  maxLength: 10000, // 10KB limit per string
}

/**
 * Common dangerous patterns to detect and log.
 */
const DANGEROUS_PATTERNS = {
  sqlInjection: /(\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|SCRIPT)\b)/gi,
  xssAttempt: /(<script|<iframe|<img|javascript:|onerror=|onload=)/gi,
  pathTraversal: /(\.\.[/\\])+/g,
  nullByte: /\0/g,
}

/**
 * Sanitize a single string value based on options.
 */
export function sanitizeString(value: string, options: SanitizationOptions = DEFAULT_SANITIZATION_OPTIONS): string {
  let sanitized = value

  // 1. Trim whitespace
  if (options.trim !== false) {
    sanitized = sanitized.trim()
  }

  // 2. Normalize Unicode
  if (options.normalize !== false) {
    sanitized = sanitized.normalize('NFKD')
  }

  // 3. Check for dangerous patterns (log but don't remove)
  Object.entries(DANGEROUS_PATTERNS).forEach(([patternName, pattern]) => {
    if (pattern.test(sanitized)) {
      logger.warn(`Dangerous pattern detected: ${patternName}`, {
        pattern: patternName,
        preview: sanitized.substring(0, 100),
      })
    }
  })

  // 4. Enforce max length
  if (options.maxLength && sanitized.length > options.maxLength) {
    logger.warn(`String sanitization: Max length exceeded`, {
      original: sanitized.length,
      limit: options.maxLength,
    })
    sanitized = sanitized.substring(0, options.maxLength)
  }

  // 5. Check disallowed patterns
  if (options.disallowedPatterns) {
    for (const pattern of options.disallowedPatterns) {
      if (pattern.test(sanitized)) {
        logger.warn(`String sanitization: Disallowed pattern matched`, {
          pattern: pattern.source,
        })
      }
    }
  }

  return sanitized
}

/**
 * Recursively sanitize an object's string values.
 */
export function sanitizeObject(
  obj: Record<string, unknown>,
  options: SanitizationOptions = DEFAULT_SANITIZATION_OPTIONS
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value, options)
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>, options)
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) => {
        if (typeof item === 'string') {
          return sanitizeString(item, options)
        } else if (item && typeof item === 'object') {
          return sanitizeObject(item as Record<string, unknown>, options)
        }
        return item
      })
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Request sanitization middleware.
 *
 * Sanitizes incoming request body, query parameters, and URL parameters.
 * Logs any suspicious patterns detected during sanitization.
 */
export function sanitizeRequest(
  options: SanitizationOptions = DEFAULT_SANITIZATION_OPTIONS
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = (req as any).id || 'unknown'

    try {
      // Sanitize body
      if (req.body && typeof req.body === 'object') {
        const originalBody = JSON.stringify(req.body)
        req.body = sanitizeObject(req.body, options)
        const sanitizedBody = JSON.stringify(req.body)

        if (originalBody !== sanitizedBody) {
          logger.debug(`Request body sanitized`, {
            requestId,
            path: req.path,
            method: req.method,
          })
        }
      }

      // Sanitize query parameters
      if (req.query && typeof req.query === 'object') {
        const originalQuery = JSON.stringify(req.query)
        req.query = sanitizeObject(req.query, options)
        const sanitizedQuery = JSON.stringify(req.query)

        if (originalQuery !== sanitizedQuery) {
          logger.debug(`Request query sanitized`, {
            requestId,
            path: req.path,
            method: req.method,
          })
        }
      }

      // Sanitize URL parameters
      if (req.params && typeof req.params === 'object') {
        const originalParams = JSON.stringify(req.params)
        req.params = sanitizeObject(req.params, options)
        const sanitizedParams = JSON.stringify(req.params)

        if (originalParams !== sanitizedParams) {
          logger.debug(`Request params sanitized`, {
            requestId,
            path: req.path,
            method: req.method,
          })
        }
      }

      next()
    } catch (error) {
      logger.error(`Sanitization middleware error`, {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      })
      next()
    }
  }
}

/**
 * Middleware to detect and log potentially malicious input patterns.
 *
 * This middleware can be used in addition to detailed validation
 * to detect and log suspicious patterns early in the request pipeline.
 */
export function detectMaliciousPatterns(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req as any).id || 'unknown'

  const checkValue = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      Object.entries(DANGEROUS_PATTERNS).forEach(([patternName, pattern]) => {
        if (pattern.test(value)) {
          logger.warn(`Suspicious pattern detected in request`, {
            requestId,
            path,
            field: patternName,
            value: value.substring(0, 200),
          })
        }
      })
    }
  }

  // Check body
  if (req.body && typeof req.body === 'object') {
    for (const [key, value] of Object.entries(req.body)) {
      checkValue(value, `body.${key}`)
    }
  }

  // Check query
  if (req.query && typeof req.query === 'object') {
    for (const [key, value] of Object.entries(req.query)) {
      checkValue(value, `query.${key}`)
    }
  }

  // Check params
  if (req.params && typeof req.params === 'object') {
    for (const [key, value] of Object.entries(req.params)) {
      checkValue(value, `params.${key}`)
    }
  }

  next()
}
