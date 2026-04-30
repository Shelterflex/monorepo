import express from 'express'
import request from 'supertest'
import { describe, it, expect } from 'vitest'

import { createDocsRouter } from './docs.js'

describe('Docs Router', () => {
  it('returns 503 when swagger-ui-express is unavailable', async () => {
    const app = express()
    app.use('/docs', createDocsRouter(null))

    const res = await request(app).get('/docs').expect(503)

    expect(res.body).toEqual({
      error: 'docs_unavailable',
      message: 'API docs UI dependency is not installed in this environment.',
    })
  })
})
