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
   *     summary: Application metrics snapshot (JSON format)
   *     tags: [Health]
   *     description: >
   *       Returns per-route request counts, error rates, latency histograms
   *       (p50/p95/p99), business KPIs, and alert levels in JSON format.
   *       For Prometheus scraping, use /health/metrics/prometheus instead.
   *     responses:
   *       200:
   *         description: Metrics snapshot
   */
  router.get("/metrics", (_req: Request, res: Response) => {
    res.json(getMetricsSnapshot())
  })

  /**
   * @openapi
   * /health/metrics/prometheus:
   *   get:
   *     summary: Prometheus metrics endpoint
   *     tags: [Health]
   *     description: >
   *       Returns metrics in Prometheus exposition format for scraping.
   *       Includes HTTP, database, Soroban RPC, and business metrics.
   *     responses:
   *       200:
   *         description: Prometheus metrics
   *         content:
   *           text/plain:
   *             schema:
   *               type: string
   */
  router.get("/metrics/prometheus", async (_req: Request, res: Response) => {
    try {
      // The PrometheusExporter serves metrics on its own port,
      // but we can also fetch them programmatically
      const response = await fetch(`http://localhost:${process.env.PROMETHEUS_PORT ?? '9464'}/metrics`)
      const metrics = await response.text()
      res.set('Content-Type', 'text/plain; version=0.0.4')
      res.send(metrics)
    } catch (error) {
      res.status(500).json({
        error: 'Failed to fetch Prometheus metrics',
        message: error instanceof Error ? error.message : String(error)
      })
    }
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