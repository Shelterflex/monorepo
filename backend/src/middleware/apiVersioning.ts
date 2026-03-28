import type { Request, Response, NextFunction } from 'express'

/**
 * Supported API versions.
 * Add new versions to this array as the API evolves.
 */
export const SUPPORTED_VERSIONS = ['v1'] as const
export type ApiVersion = typeof SUPPORTED_VERSIONS[number]

/**
 * The current (latest) API version.
 */
export const CURRENT_VERSION: ApiVersion = 'v1'

/**
 * Deprecated versions that still work but emit warnings.
 * Move versions here before full removal to give clients a migration window.
 */
export const DEPRECATED_VERSIONS: ReadonlySet<string> = new Set([
  // Example: 'v0' — add versions here when they enter deprecation
])

/**
 * Sunset dates for deprecated versions (ISO 8601 date strings).
 * After this date the version may be removed entirely.
 */
export const SUNSET_DATES: Record<string, string> = {
  // Example: v0: '2026-09-01'
}

declare global {
  namespace Express {
    interface Request {
      apiVersion: ApiVersion
    }
  }
}

/**
 * Middleware that extracts the API version from the URL path or
 * `Accept-Version` header and adds deprecation warnings.
 *
 * Version resolution order:
 *  1. URL path prefix: `/api/v1/...`
 *  2. `Accept-Version` header: `v1`
 *  3. Default to CURRENT_VERSION
 *
 * Behaviour:
 *  - Recognised, non-deprecated version → sets `req.apiVersion`, no extra headers.
 *  - Deprecated version → sets `req.apiVersion`, adds `Deprecation` + `Sunset` headers.
 *  - Unrecognised version → 400 error.
 */
export function apiVersioning(req: Request, res: Response, next: NextFunction): void {
  let version: string | undefined

  // 1. Try URL path — match /api/v{N}
  const pathMatch = req.path.match(/^\/v(\d+)(\/|$)/)
  if (pathMatch) {
    version = `v${pathMatch[1]}`
  }

  // 2. Try Accept-Version header
  if (!version) {
    const header = req.headers['accept-version']
    if (typeof header === 'string' && header.trim()) {
      version = header.trim().toLowerCase()
    }
  }

  // 3. Default to current
  if (!version) {
    version = CURRENT_VERSION
  }

  // Validate it's a supported version (current or deprecated)
  const isSupported = (SUPPORTED_VERSIONS as readonly string[]).includes(version)
  const isDeprecated = DEPRECATED_VERSIONS.has(version)

  if (!isSupported && !isDeprecated) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Unsupported API version: ${version}. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}`,
      },
    })
    return
  }

  // Set version on request for downstream use
  req.apiVersion = version as ApiVersion

  // Add deprecation headers for old versions
  if (isDeprecated) {
    res.setHeader('Deprecation', 'true')
    res.setHeader('X-API-Version', version)
    res.setHeader('X-API-Deprecated', 'true')

    const sunset = SUNSET_DATES[version]
    if (sunset) {
      res.setHeader('Sunset', sunset)
    }

    // Include a Link header pointing to the current version docs
    res.setHeader(
      'Link',
      `</api/${CURRENT_VERSION}>; rel="successor-version"`,
    )
  } else {
    res.setHeader('X-API-Version', version)
  }

  next()
}
