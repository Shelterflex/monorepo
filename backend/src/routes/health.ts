import { Router, Request, Response } from "express"
import { env } from "../schemas/env.js"
import { getPool } from "../db.js"

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

  res.json({
    version: env.VERSION,
    nodeEnv: env.NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    requestId: req.requestId,
    dbConnected,
  })
})

export default router