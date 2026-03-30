import { Router, Request, Response } from "express"
import { env } from "../schemas/env.js"
import { getPoolMetrics } from "../db.js"
import { getMetricsSnapshot } from "../utils/appMetrics.js"
import { SorobanAdapter } from "../soroban/adapter.js"
import { CircuitBreakerAdapter } from "../soroban/circuit-breaker-adapter.js"

export function createHealthRouter(adapter: SorobanAdapter): Router {
  const router = Router()

  router.get("/", (req: Request, res: Response) => {
    res.json({
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      requestId: req.requestId,
    })
  })

  router.get("/details", (req: Request, res: Response) => {
    const sorobanAdapterMode = (process.env.SOROBAN_ADAPTER_MODE ?? 'stub') === 'real'
      ? 'real'
      : 'stub'

    const poolMetrics = getPoolMetrics()

    res.json({
      version: env.VERSION,
      nodeEnv: env.NODE_ENV,
      sorobanAdapterMode,
      databaseEnabled: !!process.env.DATABASE_URL,
      ...(poolMetrics ? { databasePool: poolMetrics } : {}),
      requestId: req.requestId,
    })
  })

  /**
   * @openapi
   * /health/metrics:
   *   get:
   *     summary: Application metrics snapshot
   *     tags: [Health]
   *     description: >
   *       Returns per-route request counts, error rates, latency histograms
   *       (p50/p95/p99), business KPIs, and alert levels. Suitable for
   *       scraping by Prometheus or forwarding to a Grafana data source.
   *     responses:
   *       200:
   *         description: Metrics snapshot
   */
  router.get("/metrics", (_req: Request, res: Response) => {
    res.json(getMetricsSnapshot())
  })

  /**
   * @openapi
   * /health/soroban:
   *   get:
   *     summary: Soroban circuit breaker health status
   *     tags: [Health]
   *     description: >
   *       Returns the health status and metrics of the Soroban circuit breaker.
   *       Useful for monitoring RPC service availability and circuit breaker state.
   *     responses:
   *       200:
   *         description: Circuit breaker health status
   */
  router.get("/soroban", (_req: Request, res: Response) => {
    if (adapter instanceof CircuitBreakerAdapter) {
      const metrics = adapter.getHealthStatus()
      res.json({
        status: metrics.state === 'CLOSED' ? 'healthy' : 'degraded',
        metrics,
      })
    } else {
      res.json({
        status: 'healthy',
        message: 'Circuit breaker not enabled',
      })
    }
  })

  return router
}

// Default export for backward compatibility
export default createHealthRouter