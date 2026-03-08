import express from "express"
import cors from "cors"
import { env } from "./schemas/env.js"
import { requestIdMiddleware } from "./middleware/requestId.js"
import { errorHandler } from "./middleware/errorHandler.js"
import { createLogger } from "./middleware/logger.js"
import healthRouter from "./routes/health.js"
import { createPublicRateLimiter } from "./middleware/rateLimit.js"
import publicRouter from "./routes/publicRoutes.js"
import { AppError } from "./errors/AppError.js"
import { ErrorCode } from "./errors/errorCodes.js"
import { requestLogger } from "./middleware/requestLogger.js"
import { getSorobanConfigFromEnv } from "./soroban/client.js"
import { createSorobanAdapter } from "./soroban/index.js"
import { createBalanceRouter } from "./routes/balance.js"
import { createPaymentsRouter } from "./routes/payments.js"
import { createAdminRouter } from "./routes/admin.js"
import { createDealsRouter } from "./routes/deals.js"
import { createWhistleblowerRouter } from "./routes/whistleblower.js"
import { EarningsServiceImpl } from "./services/earnings.js"
import { StubRewardsDataLayer } from "./services/stub-rewards-data-layer.js"

export function createApp() {
  const app = express()

  // Initialize Soroban adapter using your existing config function
  const sorobanConfig = getSorobanConfigFromEnv(process.env)
  const sorobanAdapter = createSorobanAdapter(sorobanConfig)

  // Initialize earnings service with stub data layer
  const rewardsDataLayer = new StubRewardsDataLayer()
  const earningsService = new EarningsServiceImpl(rewardsDataLayer, {
    usdcToNgnRate: 1600, // Example exchange rate: 1 USDC = 1600 NGN
  })

  // Core middleware
  app.use(requestIdMiddleware)

  //  Logger 
  app.use(requestLogger);

  if (env.NODE_ENV !== "production") {
    app.use(createLogger())
  }

  app.use(express.json())

  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(",").map((s: string) => s.trim()),
    }),
  )

  // Routes
  app.use("/health", healthRouter)
  app.use(createPublicRateLimiter(env))
  app.use("/", publicRouter)
  app.use('/api', createBalanceRouter(sorobanAdapter))
  app.use('/api/payments', createPaymentsRouter(sorobanAdapter))
  app.use('/api/admin', createAdminRouter(sorobanAdapter))
  app.use('/api/deals', createDealsRouter())
  app.use('/api/whistleblower', createWhistleblowerRouter(earningsService))



  // 404 catch-all — must be after all routes, before errorHandler
  app.use('*', (_req, _res, next) => {
    next(new AppError(ErrorCode.NOT_FOUND, 404, `Route ${_req.originalUrl} not found`))
  })


  // Error handler (must be last)
  app.use(errorHandler)

  return app
}