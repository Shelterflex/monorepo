import { Router, Request, Response } from "express"
import { env } from "../schemas/env.js"
import { getPoolMetrics, getPool } from "../db.js"
import { getMetricsSnapshot } from "../utils/appMetrics.js"

const router = Router()

router.get("/", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    requestId: req.requestId,
  })
})

router.get("/details", async (req: Request, res: Response) => {
  let dbConnected = false
  try {
    const pool = await getPool()
    if (pool) {
      await pool.query("SELECT 1")
      dbConnected = true
    }
  } catch (error) {
    // Log error but don't expose details in response
    console.error("[health] Database connection check failed:", error)
    dbConnected = false
  }

  const poolMetrics = getPoolMetrics()

  res.json({
    version: env.VERSION,
    nodeEnv: env.NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    sorobanAdapterMode: env.SOROBAN_ADAPTER_MODE,
    databaseEnabled: dbConnected,
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

export default router