import express from "express"
import cors from "cors"
import * as Sentry from "@sentry/node"
import { nodeProfilingIntegration } from "@sentry/profiling-node"
import { env } from "./schemas/env.js"
import { requestIdMiddleware } from "./middleware/requestId.js"
import { errorHandler } from "./middleware/errorHandler.js"
import { traceResponseMiddleware } from "./middleware/traceResponse.js"
import { createLogger } from "./middleware/logger.js"
import { logger } from "./utils/logger.js"
import { apiVersioning } from "./middleware/apiVersioning.js"
import { createHealthRouter } from "./routes/health.js"
import { createPrometheusMetricsRouter } from "./routes/prometheusMetrics.js"
import { mountOpenApiDocs } from "./docs/openApiRegistry.js"
import { createPublicRateLimiter, createAuthRateLimiter, createWalletRateLimiter } from "./middleware/rateLimit.js"
import { createRateLimiter } from "./middleware/rateLimiter.js"
import { rateLimitProfiles } from "./config/rateLimitConfig.js"
import publicRouter from "./routes/publicRoutes.js"
import { AppError } from "./errors/AppError.js"
import { ErrorCode } from "./errors/errorCodes.js"
import { requestLogger } from "./middleware/requestLogger.js"
import { getSorobanConfigFromEnv } from "./soroban/client.js"
import { createSorobanAdapter } from "./soroban/index.js"
import { createBalanceRouter } from "./routes/balance.js"
import { createPaymentsRouter } from "./routes/payments.js"
import { createAdminRouter } from "./routes/admin.js"
import { createAdminContractAccessRouter } from "./routes/adminContractAccess.js"
import { createAdminUpgradeableProxyRouter } from "./routes/adminUpgradeableProxy.js"
import { createDealsRouter } from "./routes/deals.js"
import { createWhistleblowerRouter } from "./routes/whistleblower.js"
import { createStakingRouter } from "./routes/staking.js"
import { createStakingDelegationRouter } from "./routes/stakingDelegation.js"
import { createWebhooksRouter } from "./routes/webhooks.js"
import { createDepositsRouter } from "./routes/deposits.js"
import { EarningsServiceImpl } from "./services/earnings.js"
import { StubConversionProvider } from "./services/conversionProvider.js"
import { ConversionService } from "./services/conversionService.js"
import {
  ConversionSagaService,
  createOutboxOnchainLeg,
  createNgnWalletFiatLeg,
} from "./services/conversionSagaService.js"
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
import { LatePaymentJob } from "./jobs/latePaymentJob.js"
import { DataRetentionJob } from "./jobs/dataRetentionJob.js"
import { initOutboxStore, PostgresOutboxStore } from "./outbox/store.js"
import { OutboxSender } from "./outbox/sender.js"
import { OutboxWorker } from "./outbox/worker.js"
import { DealStatusSyncWorker } from "./workers/dealStatusSyncWorker.js"
import { RentReleaseDisputeWorker } from "./workers/rentReleaseDisputeWorker.js"
import { RentToOwnSyncWorker } from "./workers/rentToOwnSyncWorker.js"
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
import { createAdminQuotaRouter } from "./routes/adminQuota.js"
import { getNotificationService } from "./notifications/index.js"
import { createWebhookReplayRouter } from "./routes/webhookReplay.js"
import { PostgresWebhookReplayStore, initWebhookReplayStore as initStore } from "./webhookReplay/index.js"
import { processWebhookDeliveryJob } from "./services/webhookDeliveryService.js"
import { kycStatusEmitter } from "./services/index.js"
import { WebhookEventType } from "./models/webhookSubscription.js"
import { enqueueDelivery } from "./services/webhookDeliveryService.js"
import { sanitizeRequest, detectMaliciousPatterns } from "./middleware/sanitization.js"
import { createComprehensiveRateLimiter } from "./middleware/comprehensiveRateLimit.js"
import { createWhistleblowerApplicationsRouter } from "./routes/whistleblowerApplications.js"
import { createAdminWhistleblowerApplicationsRouter } from "./routes/adminWhistleblowerApplications.js"
import { createAdminAnalyticsRouter } from "./routes/adminAnalytics.js"
import { createConversionProviderFromEnv } from "./services/conversionProviderFactory.js"
import { ConversionRateService } from "./services/conversionRateService.js"
import { createConversionRouter } from "./routes/conversion.js"
import { createUserPreferencesRouter } from "./routes/userPreferences.js"
import { createUserErasureRouter } from "./routes/userErasure.js"
import { createAdminErasureRouter } from "./routes/adminErasure.js"
import { createAdminAuditRouter } from "./routes/adminAudit.js"
import { createAdminAuditLogsRouter } from "./routes/adminAuditLogs.js"
import { createAdminUnderwritingRouter } from "./routes/adminUnderwriting.js"
import { PostgresRewardsDataLayer } from "./services/postgres-rewards-data-layer.js"
import { createReceiptRepository, createTimelockRepository } from "./indexer/repositoryBootstrap.js"
import { createLandlordPropertiesRouter } from "./routes/landlordProperties.js";
import { createEpochRewardsRouter } from "./routes/epochRewards.js";
import { createLandlordRouter } from "./routes/landlord.js";
import { createAdminLandlordVerificationRouter, createLandlordVerificationRouter } from "./routes/landlordVerification.js";
import { authenticateToken } from "./middleware/auth.js";
import { requireFlag } from "./middleware/requireFlag.js";
import { createFeatureFlagsRouter } from "./routes/featureFlags.js";
import { createTenantApplicationsRouter } from "./routes/tenantApplications.js";
import { createTenantSavedPropertiesRouter } from "./routes/tenantSavedProperties.js";
import { createTenantPaymentsRouter } from "./routes/tenantPayments.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import { createSettlementAdminRouter } from "./routes/settlementAdmin.js";
import { createDisputeAdminRouter } from "./routes/disputeAdmin.js";
import { SettlementOutboxWorker } from "./settlement/worker.js";
import { createLedgerReconciliationRouter } from "./routes/ledgerReconciliation.js";
import { createAdminTransactionLedgerRouter } from "./routes/adminTransactionLedger.js";
import { createAdminSessionsRouter } from "./routes/adminSessions.js";
import { durableIdempotencyService } from "./services/durableIdempotencyService.js";
import { createSupportRouter } from "./routes/support.js";
import { createPropertyIssueReportsRouter } from "./routes/propertyIssueReports.js";
import { createPropertyPhotosRouter } from "./routes/propertyPhotos.js"
import { createAccountRouter } from "./routes/account.js"
import { createAdminDataRetentionRouter } from "./routes/adminDataRetention.js";
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
import { createWhistleblowerReportsRouter } from "./routes/whistleblowerReports.js";
import { createTenantDataExportRouter } from "./routes/tenantDataExport.js";
import { createTenantErasureRouter } from "./routes/tenantErasure.js";
import { createTenantCreditScoringRouter } from "./routes/tenantCreditScoring.js";
import { createTenantOnboardingRouter } from "./routes/tenantOnboarding.js";
import { createAdminTenantCreditScoreRouter } from "./routes/adminTenantCreditScore.js";
import { createTenantDocumentVaultRouter } from "./routes/tenantDocumentVault.js";
import { createTenantDocumentsPresignRouter } from "./routes/tenantDocumentsPresign.js";
import { createTenantDocumentsRouter } from "./routes/tenantDocuments.js";
import { createReferralsRouter } from "./routes/referrals.js";
import { createLandlordPayoutScheduleRouter } from "./routes/landlordPayoutSchedule.js";
import { createDocsRouter } from "./routes/docs.js";
import { createListingsRouter } from "./routes/listings.js";
import listingApplicationsRouter from "./routes/listingApplications.js";
import { createKycRouter } from "./routes/kyc.js";
import { createAdminRolesRouter } from "./routes/adminRoles.js";
import { createAbuseRouter } from "./routes/abuse.js";
import { createInspectorJobsRouter, createAdminInspectorJobsRouter } from "./routes/inspectorJobs.js";
import { createInspectorOnboardingRouter } from "./routes/inspectorOnboarding.js";
import { createPropertyInspectionsRouter } from "./routes/propertyInspections.js";
import { createGovernanceRouter } from "./routes/governance.js";
import { createRentGuaranteeRouter } from "./routes/rentGuarantee.js";
import { createTenantRatingCardRouter } from "./routes/tenantRatingCard.js";
import { createRentGuaranteeProviderFromEnv } from "./services/insurance/rentGuaranteeProviderFactory.js";
import { createAdminCreditScoreRouter, createCreditScoreRouter } from "./routes/creditScore.js";
import { createSorobanContractsRouter } from "./routes/sorobanContracts.js";
import { createContractEventsRouter } from "./routes/contractEvents.js";
import {
  createAdminVestingScheduleRouter,
  createVestingScheduleRouter,
} from "./routes/vestingSchedule.js";
import { createWhistleblowerRewardsRouter } from "./routes/whistleblowerRewards.js";
import { createCircuitBreakerRouter } from "./routes/circuitBreaker.js";

import { initFraudStore, PostgresFraudStore } from "./fraud/index.js";
import { createAdminFraudRouter } from "./routes/adminFraud.js";
import { createAdminOutboxRouter } from "./routes/adminOutbox.js";
import { initializeCacheInvalidationWebhooks } from "./services/cacheInvalidation.js";
import { createKycWebhookRouter } from "./routes/kyc.js";
import { createOnboardingRouter } from "./routes/onboarding.js";
import { createEmployersRouter } from "./routes/employers.js";
import { createMessagingRouter } from "./routes/messaging.js";
import {
  flushQueuedMessageNotificationDigest,
  sendQueuedMessageNotificationEmail,
} from "./services/messageNotificationService.js";
import { createAttachmentsRouter } from "./routes/attachments.js";
import { MonthlyDeductionReminderJob } from "./jobs/monthlyDeductionReminderJob.js";
import { dataRetentionPurgeJobHandler, DATA_RETENTION_PURGE_JOB_NAME } from "./jobs/dataRetentionPurgeJob.js";

export function createApp() {
  const app = express();

  // Trust the first proxy hop (Vercel/Render) so req.ip reflects the real client IP
  app.set('trust proxy', 1);

  // Initialize Sentry
  if (env.NODE_ENV !== "test" && process.env.SENTRY_DSN_BACKEND) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN_BACKEND,
      environment: env.NODE_ENV || "development",
      tracesSampleRate: 0.1,
      integrations: [
        nodeProfilingIntegration(),
      ],
      beforeSend(event) {
        // Scrub PII from event data
        if (event.request) {
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers["authorization"];
            delete event.request.headers["cookie"];
          }
        }
        // Scrub PII from user data
        if (event.user) {
          delete event.user.email;
          delete event.user.phone;
          delete event.user.ip_address;
        }
        // Scrub PII from extra data
        if (event.extra) {
          const extra = event.extra;
          delete extra.email;
          delete extra.phone;
          delete extra.bvn;
          delete extra.password;
        }
        return event;
      },
    });
  }

  // Initialize secret rotation service
  if (env.NODE_ENV !== "test") {
    initializeAppSecretRotation();
  }

  // Initialize cache invalidation webhooks
  if (env.NODE_ENV !== "test") {
    initializeCacheInvalidationWebhooks();
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
  const conversionProvider = createConversionProviderFromEnv(env, {
    sorobanAdapter,
    oracleContractId: sorobanConfig.oraclePriceFeedsId,
  });
  const conversionRateService = new ConversionRateService(conversionProvider);
  const conversionService = new ConversionService(conversionProvider, "onramp");
  app.set("conversionService", conversionService);
  app.set("conversionRateService", conversionRateService);

  // Atomic fiat <-> on-chain conversion saga (FX-rate lock + saga compensation).
  // Reuses the existing exactly-once outbox sender for the on-chain leg and the
  // existing NgnWalletService reversal mechanism for compensating refunds.
  const conversionSagaService = new ConversionSagaService(
    conversionProvider,
    "onramp",
    createNgnWalletFiatLeg(ngnWalletService),
    createOutboxOnchainLeg(new OutboxSender(sorobanAdapter)),
  );
  app.set("conversionSagaService", conversionSagaService);

  const earningsService = new EarningsServiceImpl(rewardsDataLayer, conversionRateService);
  const stakingService = new StakingService(sorobanAdapter);

  // Workers collection for graceful shutdown
  const workers: { stop: () => Promise<void> }[] = [];

  // Staking Finalizer Job
  const stakingFinalizer = new StakingFinalizer(stakingService);
  stakingFinalizer.start();
  workers.push(stakingFinalizer);

  const latePaymentJob = new LatePaymentJob(
    parseInt(process.env.LATE_PAYMENT_JOB_POLL_MS ?? String(6 * 60 * 60 * 1000), 10),
  );
  if (env.NODE_ENV !== "test") {
    latePaymentJob.start();
    workers.push(latePaymentJob);
  }

  const dataRetentionJob = new DataRetentionJob(
    parseInt(process.env.DATA_RETENTION_JOB_POLL_MS ?? String(24 * 60 * 60 * 1000), 10),
  );
  const monthlyDeductionReminderJob = new MonthlyDeductionReminderJob(
    parseInt(process.env.MONTHLY_DEDUCTION_REMINDER_POLL_MS ?? String(24 * 60 * 60 * 1000), 10),
  );
  if (env.NODE_ENV !== "test") {
    dataRetentionJob.start();
    workers.push(dataRetentionJob);
    monthlyDeductionReminderJob.start();
    workers.push(monthlyDeductionReminderJob);
  }

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

    const dealStatusSyncWorker = new DealStatusSyncWorker(sorobanAdapter);
    const dealSyncIntervalMs = parseInt(
      process.env.DEAL_SYNC_WORKER_INTERVAL_MS ?? "30000",
      10,
    );
    dealStatusSyncWorker.start(dealSyncIntervalMs);
    workers.push(dealStatusSyncWorker);

    // deal_escrow's default challenge/dispute windows are 24h/48h — a 15
    // minute poll is far more than granular enough to catch expirations
    // promptly without hammering the RPC endpoint.
    const rentReleaseDisputeWorker = new RentReleaseDisputeWorker(sorobanAdapter);
    const rentReleaseDisputeIntervalMs = parseInt(
      process.env.RENT_RELEASE_DISPUTE_WORKER_INTERVAL_MS ?? "900000",
      10,
    );
    rentReleaseDisputeWorker.start(rentReleaseDisputeIntervalMs);
    workers.push(rentReleaseDisputeWorker);

    const rentToOwnSyncWorker = new RentToOwnSyncWorker(sorobanAdapter);
    const rentToOwnSyncIntervalMs = parseInt(
      process.env.RENT_TO_OWN_SYNC_WORKER_INTERVAL_MS ?? "30000",
      10,
    );
    rentToOwnSyncWorker.start(rentToOwnSyncIntervalMs);
    workers.push(rentToOwnSyncWorker);
  }

  // Job Scheduler — swap to Postgres store when DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    initJobStore(new PostgresJobStore());
  }
  const jobScheduler = new JobScheduler(
    parseInt(process.env.JOB_SCHEDULER_POLL_MS ?? '5000', 10),
  )

  // Fraud Detection Store — swap to Postgres when DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    initFraudStore(new PostgresFraudStore());
  }

  // Register notification job handler
  const notificationService = getNotificationService()
  jobScheduler.registerHandler('notification.send', async (job) => {
    await notificationService.send(job.payload as any)
  })
  jobScheduler.registerHandler('messaging.notification.digest', async (job) => {
    await flushQueuedMessageNotificationDigest(
      (job.payload as { key: string }).key,
    )
  })
  jobScheduler.registerHandler('messaging.notification.email', async (job) => {
    await sendQueuedMessageNotificationEmail(
      (job.payload as { key: string }).key,
    )
  })

  // Register webhook delivery job handler
  jobScheduler.registerHandler('webhook.delivery', async (job) => {
    await processWebhookDeliveryJob(job.payload as any)
  })

  jobScheduler.registerHandler('erasure.requested', async (job) => {
    logger.info('erasure.requested', {
      userId: (job.payload as { userId?: string }).userId,
      requestId: (job.payload as { requestId?: string }).requestId,
    })
  })

  // Register data retention purge job handler
  jobScheduler.registerHandler(DATA_RETENTION_PURGE_JOB_NAME, dataRetentionPurgeJobHandler)

  // Centralized KYC Status Change Webhook Trigger
  kycStatusEmitter.on('statusChanged', (userId: string, status: any) => {
    const eventType = status === 'approved' ? WebhookEventType.KYC_APPROVED : WebhookEventType.KYC_REJECTED
    enqueueDelivery(eventType, { userId, status }).catch(err => {
      console.error('[webhook] failed to enqueue KYC status webhook:', err)
    })
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

  // Graceful shutdown of the workers/services started above. Exposed via
  // app.locals rather than registering our own SIGTERM/SIGINT listeners here:
  // index.ts owns the single centralized signal handler for the whole process
  // (HTTP server, DB pool, Redis, and the workers it starts directly) and
  // calls this as one step in that sequence — a second independent handler
  // racing to process.exit() would risk cutting the other's cleanup short.
  if (env.NODE_ENV !== "test") {
    app.locals.shutdownWorkers = async () => {
      // Stop secret rotation watcher
      const secretRotationService = getSecretRotationService();
      secretRotationService.stopWatching();

      // Stop all workers
      await Promise.all(workers.map((w) => w.stop()));

      // Shutdown metrics
      await shutdownMetrics();
    };
  }

  // Core middleware
  app.use(requestIdMiddleware);
  app.use(traceResponseMiddleware);

  // Attach requestId to Sentry scope for error correlation
  if (env.NODE_ENV !== "test" && process.env.SENTRY_DSN_BACKEND) {
    app.use((req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
      Sentry.withScope((scope) => {
        scope.setTag("requestId", req.requestId || "unknown");
        scope.setExtra("method", req.method);
        scope.setExtra("path", req.originalUrl);
      });
      next();
    });
  }

  // Sentry request handler (must be before routes)
  if (env.NODE_ENV !== "test" && process.env.SENTRY_DSN_BACKEND) {
    app.use((Sentry as any).Handlers.requestHandler());
  }

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

  app.use(express.json({
    verify: (req, _res, buf) => {
      const url = (req as import('express').Request).originalUrl ?? req.url ?? ''
      if (url.startsWith('/api/webhooks/payments') || url.startsWith('/api/webhooks/reversals')) {
        ;(req as import('express').Request).rawBody = buf.toString('utf8')
      }
    },
  }))

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
  app.use("/metrics", createPrometheusMetricsRouter())
  app.use("/health", createHealthRouter(sorobanAdapter))

  // OpenAPI / Swagger docs (issue #929). Disabled in production unless the
  // operator explicitly opts in via a guard middleware.
  mountOpenApiDocs(app)

  // API versioning — applied to all /api routes after rate limiting
  app.use('/api', apiVersioning)

  // Redis-backed rate limiters (issue #1046)
  // publicSearch: 60 req/min per IP for unauthenticated listing/search endpoints
  const publicSearchLimiter = createRateLimiter(rateLimitProfiles.publicSearch)
  // authenticated: 300 req/min per user (JWT sub) for all authenticated API routes
  const authenticatedLimiter = createRateLimiter(rateLimitProfiles.authenticated)

  // Apply authenticated limiter globally after JWT auth middleware has run
  app.use('/api/v1', authenticatedLimiter)

  // Apply publicSearch limiter to listing/property search routes
  app.use('/api/v1/landlord/properties', publicSearchLimiter)

  // Mount all API routes under /api/v1/
  app.use("/api/v1/auth", createAuthRateLimiter(env), authRouter)
  app.use("/api/v1/conversion", createConversionRouter(conversionRateService))
  app.use("/api/v1/user", createUserPreferencesRouter())
  app.use("/api/v1/user", createUserErasureRouter())
  app.use(createPublicRateLimiter(env))

  app.use("/", publicRouter)
  app.use("/soroban", createSorobanContractsRouter())
  app.use('/api/v1', createBalanceRouter(sorobanAdapter))
  app.use('/api/v1', createReceiptsRouter(receiptRepo))
  app.use('/api/v1/wallet', createWalletRateLimiter(env), createWalletRouter(walletService))
  app.use('/api/v1/wallet/ngn', createNgnWalletRouter(ngnWalletService))
  app.use('/api/v1/risk', createRiskRouter(ngnWalletService))
  app.use('/api/v1/admin/risk', createAdminRiskRouter(ngnWalletService))
  app.use('/api/v1/admin', createAdminWithdrawalsRouter(ngnWalletService))
  app.use('/api/v1/payments', createPaymentsRouter(sorobanAdapter))
  app.use('/api/v1/admin', createAdminRouter(sorobanAdapter, walletStore as any, encryptionService as any, indexer))
  app.use('/api/v1/admin/contract-access', createAdminContractAccessRouter(sorobanAdapter))
  app.use('/api/v1/admin/upgradeable-proxy', createAdminUpgradeableProxyRouter(sorobanAdapter))
  app.use('/api/v1/admin/reconciliation', createAdminReconciliationRouter(ngnWalletService))
  app.use('/api/v1/admin/vesting-schedule', createAdminVestingScheduleRouter(sorobanAdapter))
  app.use('/api/v1/vesting-schedule', createVestingScheduleRouter(sorobanAdapter))
  app.use('/api/v1/whistleblower-rewards', createWhistleblowerRewardsRouter(sorobanAdapter))
  app.use('/api/v1/admin/circuit-breaker', createCircuitBreakerRouter(sorobanAdapter))
  app.use('/api/v1/admin/secrets', createSecretRotationRouter())
  app.use('/api/v1/admin/jobs', createAdminJobsRouter())
  app.use('/api/v1/admin/quota', createAdminQuotaRouter())
  app.use('/api/v1/admin/webhook-replay', createWebhookReplayRouter())
  app.use('/api/v1/deals', createDealsRouter())
  app.use('/api/v1/whistleblower', createWhistleblowerRouter(earningsService))
  app.use('/api/v1/staking', createStakingRouter(sorobanAdapter, walletService, linkedAddressStore, ngnWalletService, conversionService, stakingService, receiptRepo, conversionRateService))
  app.use('/api/v1/webhooks', createWebhooksRouter(ngnWalletService))
  app.use('/api/v1/deposits', createDepositsRouter(conversionService))
  app.use('/api/v1/gas-metrics', createGasMetricsRouter())
  app.use('/api/v1', migrationGuideRouter)
  app.use("/health", createHealthRouter(sorobanAdapter));

  // Global API Rate Limiting
  app.use("/api/v1", createComprehensiveRateLimiter());

  app.use("/api/v1/auth", authRouter);

  app.use("/api/v1/support", createSupportRouter());
  app.use("/api/v1/property-issue-reports", createPropertyIssueReportsRouter());

  // In test mode, also mount routes at /api/ for backward compatibility with existing tests
  if (env.NODE_ENV === 'test') {
    app.use("/api/auth", createAuthRateLimiter(env), authRouter)
    app.use("/api/conversion", createConversionRouter(conversionRateService))
    app.use("/api/user", createUserPreferencesRouter())
    app.use("/api/user", createUserErasureRouter())
    app.use('/api', createBalanceRouter(sorobanAdapter))
    app.use('/api', createReceiptsRouter(receiptRepo))
    app.use('/api/wallet', createWalletRateLimiter(env), createWalletRouter(walletService))
    app.use('/api/wallet/ngn', createNgnWalletRouter(ngnWalletService))
    app.use('/api/risk', createRiskRouter(ngnWalletService))
    app.use('/api/admin/risk', createAdminRiskRouter(ngnWalletService))
    app.use('/api/admin', createAdminWithdrawalsRouter(ngnWalletService))
    app.use('/api/payments', createPaymentsRouter(sorobanAdapter))
    app.use('/api/admin', createAdminRouter(sorobanAdapter, walletStore as any, encryptionService as any, indexer))
    app.use('/api/admin/contract-access', createAdminContractAccessRouter(sorobanAdapter))
    app.use('/api/admin/upgradeable-proxy', createAdminUpgradeableProxyRouter(sorobanAdapter))
    app.use('/api/admin/reconciliation', createAdminReconciliationRouter(ngnWalletService))
    app.use('/api/admin/vesting-schedule', createAdminVestingScheduleRouter(sorobanAdapter))
    app.use('/api/vesting-schedule', createVestingScheduleRouter(sorobanAdapter))
    app.use('/api/whistleblower-rewards', createWhistleblowerRewardsRouter(sorobanAdapter))
    app.use('/api/admin/circuit-breaker', createCircuitBreakerRouter(sorobanAdapter))
    app.use('/api/admin/secrets', createSecretRotationRouter())
    app.use('/api/admin/jobs', createAdminJobsRouter())
    app.use('/api/admin/quota', createAdminQuotaRouter())
    app.use('/api/admin/webhook-replay', createWebhookReplayRouter())
    app.use('/api', createContractEventsRouter())
    app.use('/api/deals', createDealsRouter())
    app.use('/api/whistleblower', createWhistleblowerRouter(earningsService))
    app.use('/api/webhooks', createWebhooksRouter(ngnWalletService))
    app.use('/api/deposits', createDepositsRouter(conversionService))
    app.use('/api/gas-metrics', createGasMetricsRouter())
    app.use('/api', migrationGuideRouter)
    app.use("/api", createComprehensiveRateLimiter());
    app.use("/api/auth", authRouter);
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
    app.use("/api/admin/contract-access", createAdminContractAccessRouter(sorobanAdapter));
    app.use("/api/admin/upgradeable-proxy", createAdminUpgradeableProxyRouter(sorobanAdapter));
    app.use(
      "/api/admin/reconciliation",
      createAdminReconciliationRouter(ngnWalletService),
    );
    app.use("/api/admin/ledger-reconciliation", createLedgerReconciliationRouter());
    app.use("/api/admin/transaction-ledger", createAdminTransactionLedgerRouter());
    app.use("/api/admin/sessions", createAdminSessionsRouter());
    app.use("/api/admin/secrets", createSecretRotationRouter());
    app.use("/api/admin/jobs", createAdminJobsRouter());
    app.use("/api/admin/quota", createAdminQuotaRouter());
    app.use("/api/admin/fraud", createAdminFraudRouter());
    app.use("/api/admin/outbox", createAdminOutboxRouter(sorobanAdapter));
    app.use("/api/admin", createAdminAuditRouter());
    app.use("/api/admin/erasure", createAdminErasureRouter());
    app.use("/api/deals", createDealsRouter());
    app.use("/api", createEmployersRouter());
    app.use("/api/whistleblower", createWhistleblowerRouter(earningsService));
    app.use("/api/whistleblower-applications", createWhistleblowerApplicationsRouter());
    app.use("/api/admin/whistleblower-applications", createAdminWhistleblowerApplicationsRouter());
    app.use("/api/admin/underwriting", createAdminUnderwritingRouter());
    app.use("/api/admin/analytics", createAdminAnalyticsRouter());
    app.use("/api/admin", createAdminTenantCreditScoreRouter());
    app.use("/api/admin/credit-score", createAdminCreditScoreRouter());
    app.use("/api/admin", createSettlementAdminRouter());
    app.use("/api", createContractEventsRouter());
    app.use("/api/config/feature-flags", createFeatureFlagsRouter());
    // Mounted ahead of "/api/staking" so the delegation prefix wins; the
    // stake_delegation contract is a separate ledger from staking_pool.
    app.use(
      "/api/staking/delegation",
      requireFlag("STAKING_ENABLED"),
      createStakingDelegationRouter(sorobanAdapter, walletService, linkedAddressStore),
    );
    app.use(
      "/api/staking",
      requireFlag("STAKING_ENABLED"),
      createStakingRouter(
        sorobanAdapter,
        walletService,
        linkedAddressStore,
        ngnWalletService,
        conversionService,
        stakingService,
        receiptRepo,
        conversionRateService,
      ),
    );
    app.use("/api/webhooks", createWebhooksRouter(ngnWalletService));
    app.use("/api/deposits", createDepositsRouter(conversionService));
    app.use("/api/gas-metrics", createGasMetricsRouter());
    app.use("/api", createPropertyPhotosRouter());
    app.use("/api/landlord/properties", createLandlordPropertiesRouter());
    app.use("/api/epoch-rewards", createEpochRewardsRouter());
    app.use(
      "/api/landlord/partner-applications",
      createPartnerLandlordApplicationsRouter(),
    );
    app.use("/api/landlord", authenticateToken, createLandlordRouter());
    app.use("/api/tenant/applications", createTenantApplicationsRouter());
    app.use(
      "/api/tenant/saved-properties",
      createTenantSavedPropertiesRouter(),
    );
    app.use(
      "/api/whistleblower/applications",
      createWhistleblowerApplicationsRouter(),
    );
    app.use("/api/tenant/payments", createTenantPaymentsRouter());
    app.use("/api/notifications", createNotificationsRouter());
    app.use("/api/admin", createSettlementAdminRouter());
    app.use("/api/admin", createAdminRolesRouter());
    app.use("/api/apartment-reviews", createApartmentReviewsRouter());
    app.use("/api/reports", createWhistleblowerReportsRouter());
    app.use("/api/tenant/data-export", createTenantDataExportRouter());
    app.use("/api/tenant/erasure", createTenantErasureRouter());
    app.use("/api/inspector/onboarding", createInspectorOnboardingRouter());
  }

  app.use(
    "/api/v1/wallet",
    createWalletRouter(walletService),
  );
  app.use("/api/v1/wallet/ngn", createNgnWalletRouter(ngnWalletService));
  app.use("/api/v1/risk", createRiskRouter(ngnWalletService));
  app.use("/api/v1/admin/risk", createAdminRiskRouter(ngnWalletService));
  app.use("/api/v1/admin", createAdminWithdrawalsRouter(ngnWalletService));
  app.use("/api/v1/payments", createPaymentsRouter(sorobanAdapter));
  app.use(
    "/api/v1/admin",
    createAdminRouter(
      sorobanAdapter,
      walletStore as any,
      encryptionService as any,
      indexer,
    ),
  );
  app.use("/api/v1/admin/contract-access", createAdminContractAccessRouter(sorobanAdapter));
  app.use("/api/v1/admin/upgradeable-proxy", createAdminUpgradeableProxyRouter(sorobanAdapter));
  app.use(
    "/api/v1/admin/reconciliation",
    createAdminReconciliationRouter(ngnWalletService),
  );
  app.use("/api/v1/admin/ledger-reconciliation", createLedgerReconciliationRouter());
  app.use("/api/v1/admin/transaction-ledger", createAdminTransactionLedgerRouter());
  app.use("/api/v1/admin/sessions", createAdminSessionsRouter());
  app.use("/api/v1/admin/secrets", createSecretRotationRouter());
  app.use("/api/v1/admin/jobs", createAdminJobsRouter());
  app.use("/api/v1/admin/quota", createAdminQuotaRouter());
  app.use("/api/v1/admin/fraud", createAdminFraudRouter());
  app.use("/api/v1/admin/outbox", createAdminOutboxRouter(sorobanAdapter));
  app.use("/api/v1/admin", createAdminAuditRouter());
  app.use("/api/v1/admin/audit-logs", createAdminAuditLogsRouter());
  app.use("/api/v1/admin/erasure", createAdminErasureRouter());
  app.use("/api/v1/deals", createDealsRouter());
  app.use("/api/v1", createEmployersRouter());
  app.use("/api/v1/whistleblower", createWhistleblowerRouter(earningsService));
  app.use("/api/v1/whistleblower-applications", createWhistleblowerApplicationsRouter());
  app.use("/api/v1/admin/whistleblower-applications", createAdminWhistleblowerApplicationsRouter());
  app.use("/api/v1/admin/underwriting", createAdminUnderwritingRouter());
  app.use("/api/v1/admin/analytics", createAdminAnalyticsRouter());
  app.use("/api/v1/admin", createAdminTenantCreditScoreRouter());
  app.use("/api/v1/admin/credit-score", createAdminCreditScoreRouter());
  app.use("/api/v1/admin", createSettlementAdminRouter());
  app.use("/api/v1/admin/disputes", createDisputeAdminRouter());
  app.use("/api/v1/config/feature-flags", createFeatureFlagsRouter());


  app.use(
    "/api/v1/staking/delegation",
    requireFlag("STAKING_ENABLED"),
    createStakingDelegationRouter(sorobanAdapter, walletService, linkedAddressStore),
  );
  app.use(
    "/api/v1/staking",
    requireFlag("STAKING_ENABLED"),
    createStakingRouter(
      sorobanAdapter,
      walletService,
      linkedAddressStore,
      ngnWalletService,
      conversionService,
      stakingService,
      receiptRepo,
      conversionRateService,
    ),

  );
  app.use("/api/v1/webhooks", createWebhooksRouter(ngnWalletService));
  app.use("/api/v1/deposits", createDepositsRouter(conversionService));
  app.use("/api/v1/gas-metrics", createGasMetricsRouter());
  app.use("/api/v1", createPropertyPhotosRouter());
  app.use("/api/v1/landlord/properties", createLandlordPropertiesRouter());
  app.use(
    "/api/v1/landlord/partner-applications",
    createPartnerLandlordApplicationsRouter(),
  );
  app.use("/api/v1/landlords", createLandlordVerificationRouter());
  app.use("/api/v1/landlord", authenticateToken, createLandlordRouter());
  app.use("/api/v1/admin", createAdminLandlordVerificationRouter());
  app.use("/api/v1/tenant/applications", createTenantApplicationsRouter());
  app.use(
    "/api/v1/tenant/saved-properties",
    createTenantSavedPropertiesRouter(),
  );
  app.use(
    "/api/v1/whistleblower/applications",
    createWhistleblowerApplicationsRouter(),
  );
  app.use("/api/tenant/payments", createTenantPaymentsRouter());
  app.use("/api/notifications", createNotificationsRouter());
  app.use("/api/admin", createSettlementAdminRouter());
  app.use("/api/admin", createAdminRolesRouter());
  app.use("/api/admin/disputes", createDisputeAdminRouter());
  app.use("/api/apartment-reviews", createApartmentReviewsRouter());
  app.use("/api/compliance/reports", createComplianceReportRouter());
  app.use("/api/kyc", createKycRouter());
  app.use("/api/admin/abuse", createAbuseRouter());
  app.use("/api/tenant/credit-scoring", createTenantCreditScoringRouter());
  app.use("/api/tenant/credit-score", createCreditScoreRouter());
  app.use("/api/tenant/onboarding", createTenantOnboardingRouter());
  app.use("/api/tenant/vault", createTenantDocumentVaultRouter());
  app.use("/api/listings", createListingsRouter());
  app.use("/api", listingApplicationsRouter);
  app.use("/api/landlord/payout-schedule", createLandlordPayoutScheduleRouter());
  app.use("/api/webhooks/kyc", createKycWebhookRouter());
  app.use("/api/onboarding", createOnboardingRouter());
  app.use("/api", migrationGuideRouter);

  // Account and data retention routes
  app.use("/api/v1", createAccountRouter());
  app.use("/api/v1", createAdminDataRetentionRouter());

  // Inspector job routes — gated by INSPECTOR_DASHBOARD_ENABLED flag
  app.use('/api/v1/inspector', authenticateToken, requireFlag('INSPECTOR_DASHBOARD_ENABLED'), createInspectorJobsRouter(sorobanAdapter))
  app.use('/api/v1/admin/inspector', authenticateToken, requireFlag('INSPECTOR_DASHBOARD_ENABLED'), createAdminInspectorJobsRouter())
  app.use('/api/v1/inspector/onboarding', createInspectorOnboardingRouter())

  // Property inspection routes
  app.use('/api/v1', createPropertyInspectionsRouter())

  // Rent guarantee insurance routes
  const rentGuaranteeProvider = createRentGuaranteeProviderFromEnv(process.env.RENT_GUARANTEE_PROVIDER)
  app.use('/api/v1', createRentGuaranteeRouter(rentGuaranteeProvider))

  // Tenant rating card routes
  app.use('/api/v1', createTenantRatingCardRouter(sorobanAdapter))

  // Stake-weighted governance proposal/voting routes — gated by GOVERNANCE_ENABLED flag.
  // Distinct from the timelock admin queue (admin-timelock.js); see contracts/governance.
  app.use('/api/v1/governance', authenticateToken, requireFlag('GOVERNANCE_ENABLED'), createGovernanceRouter(sorobanAdapter, linkedAddressStore))

  // Interactive API documentation
  app.use("/api/v1/messaging", createMessagingRouter());
  app.use("/api/v1/messaging/attachments", createAttachmentsRouter());
  app.use("/docs", createDocsRouter());

  // Backward compatibility redirect from /api/* to /api/v1/*
  // In test mode, also mount routes at /api/ to avoid breaking existing tests
  app.use('/api', (req, res, next) => {
    // Skip if already on /api/v1 path
    if (req.path.startsWith('/v1')) {
      return next()
    }
    
    // In test mode, allow /api/ to work by not redirecting
    // Routes will be mounted at both /api/ and /api/v1/ in test mode
    if (env.NODE_ENV === 'test') {
      return next()
    }
    
    // Redirect to /api/v1/* with deprecation headers
    const newPath = `/api/v1${req.path}`
    res.setHeader('Deprecation', 'true')
    const sunsetDate = new Date()
    sunsetDate.setMonth(sunsetDate.getMonth() + 6)
    res.setHeader('Sunset', sunsetDate.toISOString().split('T')[0])
    res.setHeader('Link', '</api/v1>; rel="successor-version"')
    res.redirect(307, newPath)
  })

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

  // Sentry error handler (must be after all routes, before errorHandler)
  if (env.NODE_ENV !== "test" && process.env.SENTRY_DSN_BACKEND) {
    app.use((Sentry as any).Handlers.errorHandler());
  }

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
