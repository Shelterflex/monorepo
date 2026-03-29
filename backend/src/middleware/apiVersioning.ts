import type { Request, Response, NextFunction } from 'express'

/**
 * Supported API versions.
 * Add new versions to this array as the API evolves.
 * Versions are resolved in order: URL path > Accept-Version header > default.
 */
export const SUPPORTED_VERSIONS = ['v1', 'v2'] as const
export type ApiVersion = typeof SUPPORTED_VERSIONS[number]

/**
 * The current (latest) API version.
 */
export const CURRENT_VERSION: ApiVersion = 'v2'

/**
 * Deprecated versions that still work but emit warnings.
 * Move versions here before full removal to give clients a migration window.
 */
export const DEPRECATED_VERSIONS: ReadonlySet<string> = new Set([
  'v1', // v1 deprecated — migrate to v2 before 2027-01-01
])

/**
 * Sunset dates for deprecated versions (ISO 8601 date strings).
 * After this date the version may be removed entirely.
 */
export const SUNSET_DATES: Record<string, string> = {
  v1: '2027-01-01',
}

/**
 * Breaking changes per version — used to generate migration guides.
 */
export const VERSION_CHANGELOG: Record<string, string[]> = {
  v2: [
    'Pagination shape changed: { data, meta } instead of flat array',
    'Error responses now include a `classification` field',
    'Timestamps are ISO 8601 strings (previously Unix ms integers)',
  ],
}

declare global {
  namespace Express {
    interface Request {
      apiVersion: ApiVersion
    }
  }
}

/**
 * Returns the migration guide for a deprecated version as plain text.
 */
export function getMigrationGuide(fromVersion: string): string {
  const changes = VERSION_CHANGELOG[CURRENT_VERSION] ?? []
  return [
    `Migration guide: ${fromVersion} → ${CURRENT_VERSION}`,
    '',
    'Breaking changes:',
    ...changes.map((c) => `  - ${c}`),
    '',
    `Sunset date for ${fromVersion}: ${SUNSET_DATES[fromVersion] ?? 'TBD'}`,
    `Docs: /api/${CURRENT_VERSION}/docs`,
  ].join('\n')
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
