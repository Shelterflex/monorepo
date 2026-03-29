import { Router, type Request, type Response } from 'express'
import {
  SUPPORTED_VERSIONS,
  CURRENT_VERSION,
  DEPRECATED_VERSIONS,
  SUNSET_DATES,
  VERSION_CHANGELOG,
  getMigrationGuide,
} from '../middleware/apiVersioning.js'

const router = Router()

/**
 * GET /api/versions
 * Returns all supported versions, deprecation status, and sunset dates.
 */
router.get('/versions', (_req: Request, res: Response) => {
  const versions = (SUPPORTED_VERSIONS as readonly string[]).map((v) => ({
    version: v,
    current: v === CURRENT_VERSION,
    deprecated: DEPRECATED_VERSIONS.has(v),
    sunsetDate: SUNSET_DATES[v] ?? null,
    breakingChanges: VERSION_CHANGELOG[v] ?? [],
  }))

  res.json({
    currentVersion: CURRENT_VERSION,
    versions,
  })
})

/**
 * GET /api/migration-guide/:from
 * Returns a plain-text migration guide from a deprecated version to the current one.
 */
router.get('/migration-guide/:from', (req: Request, res: Response) => {
  const { from } = req.params

  const allVersions = [
    ...(SUPPORTED_VERSIONS as readonly string[]),
    ...Array.from(DEPRECATED_VERSIONS),
  ]

  if (!allVersions.includes(from)) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `No migration guide found for version: ${from}`,
      },
    })
    return
  }

  if (from === CURRENT_VERSION) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `${from} is already the current version. No migration needed.`,
      },
    })
    return
  }

  res.type('text/plain').send(getMigrationGuide(from))
})

export default router
