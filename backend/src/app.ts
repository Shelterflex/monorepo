import express from "express"
import cors from "cors"
import { env } from "./schemas/env.js"
import { requestIdMiddleware } from "./middleware/requestId.js"
import { errorHandler } from "./middleware/errorHandler.js"
import { traceResponseMiddleware } from "./middleware/traceResponse.js"
import { createLogger } from "./middleware/logger.js"
import { logger } from "./utils/logger.js"
import { apiVersioning } from "./middleware/apiVersioning.js"
import healthRouter from "./routes/health.js"
import { createPublicRateLimiter, createAuthRateLimiter, createWalletRateLimiter } from "./middleware/rateLimit.js"
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
import { createStakingRouter } from "./routes/staking.js"
import { createWebhooksRouter } from "./routes/webhooks.js"
import { createDepositsRouter } from "./routes/deposits.js"
import { EarningsServiceImpl } from "./services/earnings.js"
import { StubConversionProvider } from "./services/conversionProvider.js"
import { ConversionService } from "./services/conversionService.js"
import { createWalletRouter } from "./routes/wallet.js"
import { createNgnWalletRouter } from "./routes/ngnWallet.js"
import { createAdminRiskRouter } from "./routes/adminRisk.js"
import { createAdminWithdrawalsRouter } from "./routes/adminWithdrawals.js"
import { createRiskRouter } from "./routes/risk.js"
import { WalletServiceImpl, EnvironmentEncryptionService, KeyringEncryptionService, readEncryptionKeyringFromEnv } from "./services/walletService.js"
import { CustodialWalletServiceImpl } from "./services/CustodialWalletServiceImpl.js"
import { NgnWalletService } from "./services/ngnWalletService.js"
import { createAdminReconciliationRouter } from "./routes/adminReconciliation.js"
import { InMemoryWalletStore, PostgresWalletStore } from "./models/walletStore.js"
import { InMemoryLinkedAddressStore, PostgresLinkedAddressStore } from "./models/linkedAddressStore.js"
import { StubRewardsDataLayer } from "./services/stub-rewards-data-layer.js"
import authRouter from "./routes/auth.js"
import { StubReceiptRepository, PostgresReceiptRepository } from "./indexer/receipt-repository.js"
import { ReceiptIndexer } from "./indexer/worker.js"
import { createReceiptsRouter } from "./routes/receiptsRoute.js"
import { getPool } from "./db.js"
import { StakingService } from "./services/stakingService.js"
import { StakingFinalizer } from "./jobs/stakingFinalizer.js"
import { initOutboxStore, PostgresOutboxStore } from "./outbox/store.js"
import { OutboxSender } from "./outbox/sender.js"
import { OutboxWorker } from "./outbox/worker.js"
import { initializeAppSecretRotation, secretRotationMiddleware, createSecretRotationRouter } from "./middleware/secretRotation.js"
import { getSecretRotationService } from "./services/secretRotationService.js"
import migrationGuideRouter from "./routes/migrationGuide.js"


export function createApp() {
  const app = express()

  // Initialize secret rotation service
  if (env.NODE_ENV !== 'test') {
    initializeAppSecretRotation();
  }

  // Test database
  async function testDb() {
    const pool = await getPool()
    if (!pool) return
    const result = await pool.query("SELECT NOW()");
    console.log("Database connected at:", result.rows[0].now);
  }

  if (env.NODE_ENV !== 'test') {
    testDb();
  }

  // Initialize Soroban adapter using your existing config function
  const sorobanConfig = getSorobanConfigFromEnv(process.env)
  const sorobanAdapter = createSorobanAdapter(sorobanConfig)

  // Initialize earnings service with stub data layer
  // Initialize wallet service and store
  const walletStore = process.env.DATABASE_URL
    ? new PostgresWalletStore()
    : new InMemoryWalletStore()
  const keyring = readEncryptionKeyringFromEnv(process.env as Record<string, string | undefined>)
  const hasKeyring = Object.keys(keyring).length > 0
  const encryptionService = hasKeyring
    ? new KeyringEncryptionService(keyring)
    : new EnvironmentEncryptionService(env.ENCRYPTION_KEY)

  // Bridge the old interfaces to the new security boundary interfaces
  const keyStoreAdapter = {
    getEncryptedKey: async (userId: string) => {
      const key = await walletStore.getEncryptedKey(userId)
      if (!key) throw new Error('Key not found')
      const publicAddress = await walletStore.getPublicAddress(userId)
      return {
        envelope: JSON.parse(Buffer.from(key.cipherText, 'base64').toString('utf8')),
        keyVersion: key.keyId,
        publicAddress
      }
    },
    getPublicAddress: (userId: string) => walletStore.getPublicAddress(userId)
  }

  const decryptorAdapter = {
    decrypt: async (envelope: unknown) => {
      const cipherText = Buffer.from(JSON.stringify(envelope), 'utf8')
      const record = envelope as { version: number }
      void record
      const keyVersion = (envelope as any)?.keyVersion
      if (typeof keyVersion !== 'string' || !keyVersion) {
        throw new Error('Missing key version for decryption')
      }
      return encryptionService.decrypt(cipherText, keyVersion)
    }
  }

  const custodialService = new CustodialWalletServiceImpl(
    keyStoreAdapter as any,
    decryptorAdapter as any,
    sorobanConfig.networkPassphrase
  )

  const walletService = new WalletServiceImpl(walletStore, encryptionService, custodialService)
  const linkedAddressStore = process.env.DATABASE_URL
    ? new PostgresLinkedAddressStore()
    : new InMemoryLinkedAddressStore()
  const ngnWalletService = new NgnWalletService()

  const rewardsDataLayer = new StubRewardsDataLayer()
  const earningsService = new EarningsServiceImpl(rewardsDataLayer, {
    usdcToNgnRate: 1600, // Example exchange rate: 1 USDC = 1600 NGN
  })

  const conversionProvider = new StubConversionProvider(env.FX_RATE_NGN_PER_USDC)
  const conversionService = new ConversionService(conversionProvider, 'onramp')
  app.set('conversionService', conversionService)
  const stakingService = new StakingService(sorobanAdapter)

  // Workers collection for graceful shutdown
  const workers: { stop: () => Promise<void> }[] = []

  // Staking Finalizer Job
  const stakingFinalizer = new StakingFinalizer(stakingService)
  stakingFinalizer.start()
  workers.push(stakingFinalizer)

  // Outbox store — swap to Postgres when DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    initOutboxStore(new PostgresOutboxStore())
  }

  // OutboxWorker — runs the retry loop in non-test environments
  if (env.NODE_ENV !== 'test') {
    const outboxSender = new OutboxSender(sorobanAdapter)
    const outboxWorker = new OutboxWorker(outboxSender)
    const intervalMs = parseInt(process.env.OUTBOX_WORKER_INTERVAL_MS ?? '60000', 10)
    outboxWorker.start(intervalMs)
    workers.push(outboxWorker)
  }

  // Indexer
  const receiptRepo = process.env.DATABASE_URL
    ? new PostgresReceiptRepository()
    : new StubReceiptRepository()
  const indexer = new ReceiptIndexer(sorobanAdapter, receiptRepo, {
    pollIntervalMs: parseInt(process.env.INDEXER_POLL_MS ?? '5000'),
    startLedger: process.env.INDEXER_START_LEDGER ? parseInt(process.env.INDEXER_START_LEDGER) : undefined,
  })
  indexer.start()
  workers.push(indexer)

  // Graceful shutdown orchestration
  if (env.NODE_ENV !== 'test') {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`)

      const timeoutMs = 30000
      const timeout = setTimeout(() => {
        logger.error(`Graceful shutdown timed out after ${timeoutMs}ms, forcing exit`)
        process.exit(1)
      }, timeoutMs)

      try {
        // Stop secret rotation watcher
        const secretRotationService = getSecretRotationService();
        secretRotationService.stopWatching();

        // Stop all workers
        await Promise.all(workers.map(w => w.stop()))
        clearTimeout(timeout)
        logger.info('Graceful shutdown completed successfully')
        process.exit(0)
      } catch (err) {
        logger.error('Error during graceful shutdown', { error: err instanceof Error ? err.message : String(err) })
        process.exit(1)
      }
    }

    process.once('SIGTERM', () => void shutdown('SIGTERM'))
    process.once('SIGINT', () => void shutdown('SIGINT'))
  }

  // Core middleware
  app.use(requestIdMiddleware)
  app.use(traceResponseMiddleware)

  // Secret rotation middleware
  app.use(secretRotationMiddleware)

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
  app.use("/api/auth", createAuthRateLimiter(env), authRouter)
  app.use(createPublicRateLimiter(env))

  // API versioning — applied to all /api routes after rate limiting
  app.use('/api', apiVersioning)

  app.use("/", publicRouter)
  app.use('/api', createBalanceRouter(sorobanAdapter))
  app.use('/api', createReceiptsRouter(receiptRepo))
  app.use('/api/wallet', createWalletRateLimiter(env), createWalletRouter(walletService))
  app.use('/api/wallet/ngn', createNgnWalletRouter(ngnWalletService))
  app.use('/api/risk', createRiskRouter(ngnWalletService))
  app.use('/api/admin/risk', createAdminRiskRouter(ngnWalletService))
  app.use('/api/admin', createAdminWithdrawalsRouter(ngnWalletService))
  app.use('/api/payments', createPaymentsRouter(sorobanAdapter))
  app.use('/api/admin', createAdminRouter(sorobanAdapter, walletStore as any, encryptionService as any, indexer))
  app.use('/api/admin/reconciliation', createAdminReconciliationRouter(ngnWalletService))
  app.use('/api/admin/secrets', createSecretRotationRouter())
  app.use('/api/deals', createDealsRouter())
  app.use('/api/whistleblower', createWhistleblowerRouter(earningsService))
  app.use('/api/staking', createStakingRouter(sorobanAdapter, walletService, linkedAddressStore, ngnWalletService, conversionService, stakingService))
  app.use('/api/webhooks', createWebhooksRouter(ngnWalletService))
  app.use('/api/deposits', createDepositsRouter(conversionService))
  app.use('/api', migrationGuideRouter)



  // 404 catch-all — must be after all routes, before errorHandler
  app.use('*', (_req, _res, next) => {
    next(new AppError(ErrorCode.NOT_FOUND, 404, `Route ${_req.originalUrl} not found`))
  })



  // Error handler (must be last)
  app.use(errorHandler)

  return app
}
