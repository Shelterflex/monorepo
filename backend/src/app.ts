import express from "express"
import cors from "cors"
import { env } from "./schemas/env.js"
import { requestIdMiddleware } from "./middleware/requestId.js"
import { errorHandler } from "./middleware/errorHandler.js"
import { traceResponseMiddleware } from "./middleware/traceResponse.js"
import { createLogger } from "./middleware/logger.js"
import { logger } from "./utils/logger.js"
import { apiVersioning } from "./middleware/apiVersioning.js"
import { createHealthRouter } from "./routes/health.js"
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
import { createGasMetricsRouter } from "./routes/gas-metrics.js"
import { InMemoryWalletStore, PostgresWalletStore } from "./models/walletStore.js"
import { InMemoryLinkedAddressStore, PostgresLinkedAddressStore } from "./models/linkedAddressStore.js"
import { StubRewardsDataLayer } from "./services/stub-rewards-data-layer.js"
import authRouter from "./routes/auth.js"
import { StubReceiptRepository, PostgresReceiptRepository } from "./indexer/receipt-repository.js"
import { ReceiptIndexer } from "./indexer/worker.js"
import { createReceiptsRouter } from "./routes/receiptsRoute.js"
import { getPool, getPoolMetricsForOtel } from "./db.js"
import { StakingService } from "./services/stakingService.js"
import { StakingFinalizer } from "./jobs/stakingFinalizer.js"
import { initOutboxStore, PostgresOutboxStore } from "./outbox/store.js"
import { OutboxSender } from "./outbox/sender.js"
import { OutboxWorker } from "./outbox/worker.js"
import { initializeAppSecretRotation, secretRotationMiddleware, createSecretRotationRouter } from "./middleware/secretRotation.js"
import { getSecretRotationService } from "./services/secretRotationService.js"
import migrationGuideRouter from "./routes/migrationGuide.js"
import adminTimelockRouter from './routes/admin-timelock.js';
import { TimelockIndexer } from './indexer/timelock-worker.js';
import { PostgresTimelockRepository, StubTimelockRepository } from './indexer/timelock-repository.js';
import { TimelockProcessor } from './indexer/timelock-processor.js';
import { MetricsSorobanAdapter } from './soroban/metrics-adapter.js';
import { CircuitBreakerAdapter } from './soroban/circuit-breaker-adapter.js';
import { setDbPoolMetricsCallback, setSorobanCircuitBreakerCallback, shutdownMetrics } from './utils/metrics.js';
import { metricsMiddleware } from './middleware/metricsMiddleware.js';
import { JobScheduler, initJobStore, PostgresJobStore } from "./jobs/scheduler/index.js"
import { createAdminJobsRouter } from "./routes/adminJobs.js"
import { getNotificationService } from "./notifications/index.js"
import { createWebhookReplayRouter } from "./routes/webhookReplay.js"
import { PostgresWebhookReplayStore, initWebhookReplayStore as initStore } from "./webhookReplay/index.js"

import { sanitizeRequest, detectMaliciousPatterns } from "./middleware/sanitization.js"
import { createComprehensiveRateLimiter } from "./middleware/comprehensiveRateLimit.js"
import { createWhistleblowerApplicationsRouter } from "./routes/whistleblowerApplications.js"
import { createAdminWhistleblowerApplicationsRouter } from "./routes/adminWhistleblowerApplications.js"
import { createConversionProviderFromEnv } from "./services/conversionProviderFactory.js"
import { createAdminAuditRouter } from "./routes/adminAudit.js"
import { createAdminUnderwritingRouter } from "./routes/adminUnderwriting.js"
import { PostgresRewardsDataLayer } from "./services/postgres-rewards-data-layer.js"
import { createReceiptRepository, createTimelockRepository } from "./indexer/repositoryBootstrap.js"
import { createLandlordPropertiesRouter } from "./routes/landlordProperties.js";
import { createLandlordRouter } from "./routes/landlord.js";
import { authenticateToken } from "./middleware/auth.js";
import { createTenantApplicationsRouter } from "./routes/tenantApplications.js";
import { createTenantPaymentsRouter } from "./routes/tenantPayments.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import { createSettlementAdminRouter } from "./routes/settlementAdmin.js";
import { SettlementOutboxWorker } from "./settlement/worker.js";
import { createLedgerReconciliationRouter } from "./routes/ledgerReconciliation.js";
import { createAdminTransactionLedgerRouter } from "./routes/adminTransactionLedger.js";
import { createAdminSessionsRouter } from "./routes/adminSessions.js";
import { durableIdempotencyService } from "./services/durableIdempotencyService.js";
import { createSupportRouter } from "./routes/support.js";
import { createPropertyIssueReportsRouter } from "./routes/propertyIssueReports.js";
import {
  PostgresTenantApplicationStore,
  initTenantApplicationStore,
} from "./models/tenantApplicationStore.js";
import {
  PostgresUnderwritingDecisionTraceStore,
  initUnderwritingDecisionTraceStore,
} from "./models/underwritingDecisionTraceStore.js";
import {
  PostgresPartnerLandlordApplicationStore,
  initPartnerLandlordApplicationStore,
} from "./models/partnerLandlordApplicationStore.js";
import {
  PostgresWhistleblowerSignupApplicationStore,
  initWhistleblowerSignupApplicationStore,
} from "./models/whistleblowerSignupApplicationStore.js";
import { createPartnerLandlordApplicationsRouter } from "./routes/partnerLandlordApplications.js";
import { createApartmentReviewsRouter } from "./routes/apartmentReviews.js";
import { createComplianceReportRouter } from "./routes/complianceReport.js";
import { createTenantCreditScoringRouter } from "./routes/tenantCreditScoring.js";
import { createDocsRouter } from "./routes/docs.js";

export function createApp() {
  const app = express();

  // Initialize secret rotation service
  if (env.NODE_ENV !== "test") {
    initializeAppSecretRotation();
  }

  // Test database
  async function testDb() {
    const pool = await getPool();
    if (!pool) return;
    const result = await pool.query("SELECT NOW()");
    console.log("Database connected at:", result.rows[0].now);
  }

  if (env.NODE_ENV !== "test") {
    testDb();
  }

  // Initialize Soroban adapter using your existing config function
  const sorobanConfig = getSorobanConfigFromEnv(process.env);
  const baseSorobanAdapter = createSorobanAdapter(sorobanConfig);

  // Wrap with metrics tracking
  const sorobanAdapter = new MetricsSorobanAdapter(baseSorobanAdapter);

  // Set up circuit breaker metrics callback if using circuit breaker
  if (baseSorobanAdapter instanceof CircuitBreakerAdapter) {
    setSorobanCircuitBreakerCallback(() => {
      const status = baseSorobanAdapter.getHealthStatus();
      return status.state;
    });
  }

  // Set up database pool metrics callback
  if (env.NODE_ENV !== "test") {
    setDbPoolMetricsCallback(getPoolMetricsForOtel);
  }

  // Initialize earnings service with stub data layer
  // Initialize wallet service and store
  const walletStore = process.env.DATABASE_URL
    ? new PostgresWalletStore()
    : new InMemoryWalletStore();
  const keyring = readEncryptionKeyringFromEnv(
    process.env as Record<string, string | undefined>,
  );
  const hasKeyring = Object.keys(keyring).length > 0;
  const encryptionService = hasKeyring
    ? new KeyringEncryptionService(keyring)
    : new EnvironmentEncryptionService(env.ENCRYPTION_KEY);

  // Bridge the old interfaces to the new security boundary interfaces
  const keyStoreAdapter = {
    getEncryptedKey: async (userId: string) => {
      const key = await walletStore.getEncryptedKey(userId);
      if (!key) throw new Error("Key not found");
      const publicAddress = await walletStore.getPublicAddress(userId);
      return {
        envelope: JSON.parse(
          Buffer.from(key.cipherText, "base64").toString("utf8"),
        ),
        keyVersion: key.keyId,
        publicAddress,
      };
    },
    getPublicAddress: (userId: string) => walletStore.getPublicAddress(userId),
  };

  const decryptorAdapter = {
    decrypt: async (envelope: unknown) => {
      const cipherText = Buffer.from(JSON.stringify(envelope), "utf8");
      const record = envelope as { version: number };
      void record;
      const keyVersion = (envelope as any)?.keyVersion;
      if (typeof keyVersion !== "string" || !keyVersion) {
        throw new Error("Missing key version for decryption");
      }
      return encryptionService.decrypt(cipherText, keyVersion);
    },
  };

  const custodialService = new CustodialWalletServiceImpl(
    keyStoreAdapter as any,
    decryptorAdapter as any,
    sorobanConfig.networkPassphrase,
  );

  const walletService = new WalletServiceImpl(
    walletStore,
    encryptionService,
    custodialService,
  );
  const linkedAddressStore = process.env.DATABASE_URL
    ? new PostgresLinkedAddressStore()
    : new InMemoryLinkedAddressStore();
  const ngnWalletService = new NgnWalletService();

  // Initialize rewards data layer - use persistent implementation when DATABASE_URL is set
  const rewardsDataLayer = process.env.DATABASE_URL
    ? new PostgresRewardsDataLayer()
    : new StubRewardsDataLayer();
  const earningsService = new EarningsServiceImpl(rewardsDataLayer, {
    usdcToNgnRate: 1600, // Example exchange rate: 1 USDC = 1600 NGN
  });

  const conversionProvider = createConversionProviderFromEnv(env);
  const conversionService = new ConversionService(conversionProvider, "onramp");
  app.set("conversionService", conversionService);
  const stakingService = new StakingService(sorobanAdapter);

  // Workers collection for graceful shutdown
  const workers: { stop: () => Promise<void> }[] = [];

  // Staking Finalizer Job
  const stakingFinalizer = new StakingFinalizer(stakingService);
  stakingFinalizer.start();
  workers.push(stakingFinalizer);

  // Outbox store — swap to Postgres when DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    initOutboxStore(new PostgresOutboxStore());
  }

  // OutboxWorker — runs the retry loop in non-test environments
  if (env.NODE_ENV !== "test") {
    const outboxSender = new OutboxSender(sorobanAdapter);
    const outboxWorker = new OutboxWorker(outboxSender);
    const intervalMs = parseInt(
      process.env.OUTBOX_WORKER_INTERVAL_MS ?? "60000",
      10,
    );
    outboxWorker.start(intervalMs);
    workers.push(outboxWorker);
  }

  // Job Scheduler — swap to Postgres store when DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    initJobStore(new PostgresJobStore());
  }
  const jobScheduler = new JobScheduler(
    parseInt(process.env.JOB_SCHEDULER_POLL_MS ?? '5000', 10),
  )

  // Register notification job handler
  const notificationService = getNotificationService()
  jobScheduler.registerHandler('notification.send', async (job) => {
    await notificationService.send(job.payload as any)
  })

  // Webhook Replay Store — swap to Postgres store when DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    initStore(new PostgresWebhookReplayStore())
  }

  if (env.NODE_ENV !== 'test') {
    jobScheduler.start()
    workers.push(jobScheduler)
  }

  const settlementOutboxWorker = new SettlementOutboxWorker();
  if (env.NODE_ENV !== "test") {
    settlementOutboxWorker.start(
      parseInt(process.env.SETTLEMENT_OUTBOX_POLL_MS ?? "4000", 10),
    );
    workers.push({ stop: () => settlementOutboxWorker.stop() });
  }

  let idemReaper: ReturnType<typeof setInterval> | null = null;
  if (env.NODE_ENV !== "test") {
    const ms = parseInt(process.env.IDEMPOTENCY_RECONCILE_MS ?? "300000", 10);
    idemReaper = setInterval(() => {
      void durableIdempotencyService.reconcileStale();
    }, ms);
    if (idemReaper.unref) idemReaper.unref();
    workers.push({
      stop: async () => {
        if (idemReaper) {
          clearInterval(idemReaper);
          idemReaper = null;
        }
      },
    });
  }

  // Tenant Application Store — swap to Postgres when DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    initTenantApplicationStore(new PostgresTenantApplicationStore());
    initPartnerLandlordApplicationStore(
      new PostgresPartnerLandlordApplicationStore(),
    );
    initWhistleblowerSignupApplicationStore(
      new PostgresWhistleblowerSignupApplicationStore(),
    );
    initUnderwritingDecisionTraceStore(
      new PostgresUnderwritingDecisionTraceStore(),
    );
  }

  // Indexer
  const receiptRepo = createReceiptRepository(
    process.env.DATABASE_URL,
    env.NODE_ENV,
  );
  const indexer = new ReceiptIndexer(sorobanAdapter, receiptRepo, {
    pollIntervalMs: parseInt(process.env.INDEXER_POLL_MS ?? "5000"),
    startLedger: process.env.INDEXER_START_LEDGER
      ? parseInt(process.env.INDEXER_START_LEDGER)
      : undefined,
  });
  indexer.start();
  workers.push(indexer);

  // Timelock Indexer
  const timelockRepo = createTimelockRepository(
    process.env.DATABASE_URL,
    env.NODE_ENV,
  );
  const timelockProcessor = new TimelockProcessor(timelockRepo);
  const timelockIndexer = new TimelockIndexer(
    sorobanAdapter as any,
    timelockProcessor,
    {
      pollIntervalMs: parseInt(process.env.INDEXER_POLL_MS ?? "5000"),
      startLedger: process.env.INDEXER_START_LEDGER
        ? parseInt(process.env.INDEXER_START_LEDGER)
        : undefined,
    },
  );
  timelockIndexer.start();
  workers.push(timelockIndexer);

  // Graceful shutdown orchestration
  if (env.NODE_ENV !== "test") {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      const timeoutMs = 30000;
      const timeout = setTimeout(() => {
        logger.error(
          `Graceful shutdown timed out after ${timeoutMs}ms, forcing exit`,
        );
        process.exit(1);
      }, timeoutMs);

      try {
        // Stop secret rotation watcher
        const secretRotationService = getSecretRotationService();
        secretRotationService.stopWatching();

        // Stop all workers
        await Promise.all(workers.map((w) => w.stop()));

        // Shutdown metrics
        await shutdownMetrics();

        clearTimeout(timeout);
        logger.info("Graceful shutdown completed successfully");
        process.exit(0);
      } catch (err) {
        logger.error("Error during graceful shutdown", {
          error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      }
    };

    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));
  }

  // Core middleware
  app.use(requestIdMiddleware);
  app.use(traceResponseMiddleware);

  // Metrics middleware - track all HTTP requests
  if (env.NODE_ENV !== "test") {
    app.use(metricsMiddleware);
  }

  // Secret rotation middleware
  app.use(secretRotationMiddleware);

  //  Logger
  app.use(requestLogger);

  if (env.NODE_ENV !== "production") {
    app.use(createLogger());
  }

  app.use(express.json());

  // Core administrative routes
  app.use(
    "/api/admin/timelock",
    adminTimelockRouter(sorobanAdapter as any, timelockRepo),
  );

  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(",").map((s: string) => s.trim()),
    }),
  );

  // Routes
  app.use("/health", createHealthRouter(sorobanAdapter))
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
  app.use('/api/admin/jobs', createAdminJobsRouter())
  app.use('/api/admin/webhook-replay', createWebhookReplayRouter())
  app.use('/api/deals', createDealsRouter())
  app.use('/api/whistleblower', createWhistleblowerRouter(earningsService))
  app.use('/api/staking', createStakingRouter(sorobanAdapter, walletService, linkedAddressStore, ngnWalletService, conversionService, stakingService))
  app.use('/api/webhooks', createWebhooksRouter(ngnWalletService))
  app.use('/api/deposits', createDepositsRouter(conversionService))
  app.use('/api/gas-metrics', createGasMetricsRouter())
  app.use('/api', migrationGuideRouter)
  app.use("/health", createHealthRouter(sorobanAdapter));

  // Global API Rate Limiting
  app.use("/api", createComprehensiveRateLimiter());

  app.use("/api/auth", authRouter);

  // API versioning — applied to all /api routes after rate limiting
  app.use("/api", apiVersioning);

  app.use("/", publicRouter);
  app.use("/api", createBalanceRouter(sorobanAdapter));
  app.use("/api", createReceiptsRouter(receiptRepo));
  app.use("/api/support", createSupportRouter());
  app.use("/api/property-issue-reports", createPropertyIssueReportsRouter());
  app.use(
    "/api/wallet",
    createWalletRouter(walletService),
  );
  app.use("/api/wallet/ngn", createNgnWalletRouter(ngnWalletService));
  app.use("/api/risk", createRiskRouter(ngnWalletService));
  app.use("/api/admin/risk", createAdminRiskRouter(ngnWalletService));
  app.use("/api/admin", createAdminWithdrawalsRouter(ngnWalletService));
  app.use("/api/payments", createPaymentsRouter(sorobanAdapter));
  app.use(
    "/api/admin",
    createAdminRouter(
      sorobanAdapter,
      walletStore as any,
      encryptionService as any,
      indexer,
    ),
  );
  app.use(
    "/api/admin/reconciliation",
    createAdminReconciliationRouter(ngnWalletService),
  );
  app.use("/api/admin/ledger-reconciliation", createLedgerReconciliationRouter());
  app.use("/api/admin/transaction-ledger", createAdminTransactionLedgerRouter());
  app.use("/api/admin/sessions", createAdminSessionsRouter());
  app.use("/api/admin/secrets", createSecretRotationRouter());
  app.use("/api/admin/jobs", createAdminJobsRouter());
  app.use("/api/admin", createAdminAuditRouter());
  app.use("/api/deals", createDealsRouter());
  app.use("/api/whistleblower", createWhistleblowerRouter(earningsService));
  app.use("/api/whistleblower-applications", createWhistleblowerApplicationsRouter());
  app.use("/api/admin/whistleblower-applications", createAdminWhistleblowerApplicationsRouter());
  app.use("/api/admin/underwriting", createAdminUnderwritingRouter());
  app.use("/api/admin", createSettlementAdminRouter());
  app.use(
    "/api/staking",
    createStakingRouter(
      sorobanAdapter,
      walletService,
      linkedAddressStore,
      ngnWalletService,
      conversionService,
      stakingService,
    ),
  );
  app.use("/api/webhooks", createWebhooksRouter(ngnWalletService));
  app.use("/api/deposits", createDepositsRouter(conversionService));
  app.use("/api/gas-metrics", createGasMetricsRouter());
  app.use("/api/landlord/properties", createLandlordPropertiesRouter());
  app.use(
    "/api/landlord/partner-applications",
    createPartnerLandlordApplicationsRouter(),
  );
  app.use("/api/landlord", authenticateToken, createLandlordRouter());
  app.use("/api/tenant/applications", createTenantApplicationsRouter());
  app.use(
    "/api/whistleblower/applications",
    createWhistleblowerApplicationsRouter(),
  );
  app.use("/api/tenant/payments", createTenantPaymentsRouter());
  app.use("/api/notifications", createNotificationsRouter());
  app.use("/api/admin", createSettlementAdminRouter());
  app.use("/api/apartment-reviews", createApartmentReviewsRouter());
  app.use("/api/compliance/reports", createComplianceReportRouter());
  app.use("/api/tenant/credit-scoring", createTenantCreditScoringRouter());
  app.use("/api", migrationGuideRouter);

  // Interactive API documentation
  app.use("/docs", createDocsRouter());

  // 404 catch-all — must be after all routes, before errorHandler
  app.use("*", (_req, _res, next) => {
    next(
      new AppError(
        ErrorCode.NOT_FOUND,
        404,
        `Route ${_req.originalUrl} not found`,
      ),
    );
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
