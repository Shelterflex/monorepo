import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { validate } from './validate.js'
import { requestIdMiddleware } from './requestId.js'

describe('validate middleware', () => {
  it('returns a 400 validation error with field details', async () => {
    const app = express()
    app.use(requestIdMiddleware)
    app.use(express.json())

    const schema = z.object({
      name: z.string().min(1),
      count: z.number().int().positive(),
    })

    app.post('/test', validate(schema, 'body'), (_req, res) => {
      res.json({ ok: true })
    })

    const response = await request(app)
      .post('/test')
      .send({ name: '', count: -1 })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.message).toBe('Invalid request data')
    expect(response.body.error.details).toMatchObject({
      name: expect.any(String),
      count: expect.any(String),
    })
  })
})
