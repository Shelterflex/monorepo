import { Router, type Request, type Response, type NextFunction } from 'express'
import { env } from '../schemas/env.js'
import { metricsRegister } from '../metrics.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

export function createPrometheusMetricsRouter(): Router {
  const router = Router()

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const expectedToken = env.METRICS_TOKEN
    const authorization = req.headers.authorization
    const bearerPrefix = 'Bearer '

    if (
      !expectedToken ||
      !authorization?.startsWith(bearerPrefix) ||
      authorization.slice(bearerPrefix.length) !== expectedToken
    ) {
      return next(new AppError(ErrorCode.UNAUTHORIZED, 401, 'Unauthorized'))
    }

    try {
      res.setHeader('Content-Type', metricsRegister.contentType)
      res.end(await metricsRegister.metrics())
    } catch (error) {
      console.error('Failed to generate Prometheus metrics:', error)
      res.status(500).json({ error: 'Failed to generate metrics' })
    }
  })

  return router
}
