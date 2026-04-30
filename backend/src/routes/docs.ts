import { Router } from 'express'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { createRequire } from 'module'
import { parse } from 'yaml'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const require = createRequire(import.meta.url)

const specPath = join(__dirname, '../../docs/openapi.yml')

let spec: Record<string, unknown>
try {
  spec = parse(readFileSync(specPath, 'utf8')) as Record<string, unknown>
} catch (err) {
  console.error('[docs] Failed to load OpenAPI spec:', err)
  spec = { openapi: '3.0.3', info: { title: 'ShelterFlex API', version: '0.1.0' }, paths: {} }
}

type SwaggerUiModule = typeof import('swagger-ui-express')

let swaggerUi: SwaggerUiModule | null = null
try {
  swaggerUi = require('swagger-ui-express') as SwaggerUiModule
} catch (err) {
  console.warn('[docs] swagger-ui-express not available, docs UI disabled')
}

const uiOptions: SwaggerUiModule['SwaggerUiOptions'] = {
  customSiteTitle: 'ShelterFlex API Docs',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'list',
    filter: true,
    tryItOutEnabled: true,
  },
}

export function createDocsRouter(swaggerUiOverride: SwaggerUiModule | null = swaggerUi): Router {
  const router = Router()
  if (!swaggerUiOverride) {
    router.get('/', (_req, res) => {
      res.status(503).json({
        error: 'docs_unavailable',
        message: 'API docs UI dependency is not installed in this environment.',
      })
    })
    return router
  }

  router.use('/', swaggerUiOverride.serve)
  router.get('/', swaggerUiOverride.setup(spec, uiOptions))
  return router
}
