import { Router, type Request, type Response } from 'express'
import { env } from '../schemas/env.js'
import { metricsRegister } from '../metrics.js'

export function createPrometheusMetricsRouter(): Router {
  const router = Router()

  router.get('/', async (req: Request, res: Response) => {
    const expectedToken = env.METRICS_TOKEN
    const authorization = req.headers.authorization
    const bearerPrefix = 'Bearer '

    if (
      !expectedToken ||
      !authorization?.startsWith(bearerPrefix) ||
      authorization.slice(bearerPrefix.length) !== expectedToken
    ) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    try {
      const metrics = await metricsRegister.metrics()
      res.setHeader('Content-Type', metricsRegister.contentType)
      res.end(metrics)
    } catch (error) {
      console.error('Failed to generate Prometheus metrics:', error)
      res.status(500).json({ error: 'Failed to generate metrics' })
    }
  })

  return router
}
