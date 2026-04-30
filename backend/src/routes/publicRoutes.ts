import { Router, Request, Response } from "express"
import { env } from "../schemas/env.js"
import { validate } from "../middleware/validate.js"
import { echoRequestSchema, type EchoResponse } from "../schemas/echo.js"
import { cacheControl, CachePresets, registerEndpointCache } from "../middleware/cacheControl.js"

const publicRouter = Router()

// Register cache configurations for public routes
registerEndpointCache('/soroban/config', {
  ...CachePresets.static,
  tags: ['soroban', 'config'],
  cacheKey: 'soroban:config',
})

registerEndpointCache('/api/example/echo', CachePresets.noCache)

publicRouter.get(
  "/soroban/config",
  cacheControl(CachePresets.static),
  (_req: Request, res: Response) => {
    res.json({
      rpcUrl: env.SOROBAN_RPC_URL,
      networkPassphrase: env.SOROBAN_NETWORK_PASSPHRASE,
      contractId: env.SOROBAN_CONTRACT_ID ?? null,
    })
  }
)

// Example endpoint demonstrating Zod validation
publicRouter.post(
  "/api/example/echo",
  validate(echoRequestSchema, "body"),
  cacheControl(CachePresets.noCache),
  (req: Request, res: Response) => {
    const { message, timestamp } = req.body
    const response: EchoResponse = {
      echo: message,
      receivedAt: new Date().toISOString(),
      ...(timestamp ? { originalTimestamp: timestamp } : {}),
    }
    res.json(response)
  },
)

export default publicRouter