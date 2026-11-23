import { shutdownTracing } from "./tracing.js"
import "dotenv/config"
import { createApp } from "./app.js"
import { maybeStartOutboxWorker } from "./outbox/workerEntry.js"
import { env } from "./schemas/env.js"
import { createRequire } from "node:module"
import { getUsdcTokenAddress } from "./utils/token.js"
import { runMigrationsIfNeeded } from "./migrations/runMigrations.js"
import { validateCreditScoringConfig } from "./config/creditScoring.js"
import { validatePiiEncryptionKey } from "./utils/piiEncryption.js"
import { assertProductionIntegrations } from "./config/productionIntegrations.js"
import { startBackupJob } from "./jobs/backupJob.js"
import { ReconciliationWorker } from "./reconciliation/index.js"
import { notificationWSS } from "./services/websocket/NotificationWebSocketServer.js"
import { loadContractAddresses } from "./config/contractAddresses.js"
import { RentWalletWorker } from "./workers/rentWalletWorker.js"
import { AllowlistSyncWorker } from "./workers/allowlistSyncWorker.js"
import { SorobanEventIndexer } from "./workers/sorobanEventIndexer.js"
import { createSorobanAdapter } from "./soroban/index.js"
import { getSorobanConfigFromEnv } from "./soroban/client.js"
import { closeDbPools } from "./db.js"
import { closeRedis } from "./utils/redis.js"
import { logger } from "./utils/logger.js"

const SHUTDOWN_TIMEOUT_MS = 20_000

/**
 * Bootstrap fallback (the only direct output in this file).
 *
 * Fatal exits call process.exit() right after logging. The structured logger
 * writes to stdout asynchronously when stdout is a pipe on some platforms, so
 * the JSON line can be lost when the process exits immediately. This writes one
 * plain, readable line to stderr as well, so a failed startup is never silent.
 * It is not used for anything else.
 */
function fatalExit(message: string, detail?: string): never {
  process.stderr.write(`[backend] ${message}${detail ? `: ${detail}` : ""}\n`)
  process.exit(1)
}

const require = createRequire(import.meta.url)
const { version } = require("../package.json") as { version: string }

// WEBHOOK_KEY and SECURE_CONFIG are validated by envSchema (see schemas/env.ts);
// envSchema.parse() already throws/exits before this module runs if either is missing.

if (env.NODE_ENV === 'production') {
  try {
    getUsdcTokenAddress()
    logger.info("Environment validation passed", { network: env.SOROBAN_NETWORK })
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error"
    logger.error("Environment validation failed", {
      reason,
      hint: "Check your environment variables and restart the server",
    })
    fatalExit("Environment validation failed", `${reason}. Check your environment variables and restart the server`)
  }
}

async function main() {
  try {
    loadContractAddresses(process.env)
    validatePiiEncryptionKey(env.ENCRYPTION_KEY, env.NODE_ENV)
    // Fails fast in production when an integration would silently run on a stub (#1942).
    assertProductionIntegrations(process.env)
    const { validateLatePaymentConfig } = await import('./config/latePayment.js')
    validateLatePaymentConfig()
    await runMigrationsIfNeeded()
    const backupInterval = startBackupJob()
    const app = createApp()
    const outboxWorker = maybeStartOutboxWorker()
    const reconciliationWorker = new ReconciliationWorker()
    reconciliationWorker.start()

    // Start RentWalletWorker for on-chain rent wallet mirroring
    const sorobanConfig = getSorobanConfigFromEnv(process.env)
    const sorobanAdapter = createSorobanAdapter(sorobanConfig)
    const rentWalletWorker = new RentWalletWorker(sorobanAdapter)
    rentWalletWorker.start()

    // Push KYC approvals and revocations on-chain (#1952). Only started when the adapter
    // can manage the allowlist.
    const allowlistSyncWorker = new AllowlistSyncWorker(sorobanAdapter)
    if (sorobanAdapter.addToAllowlist && sorobanAdapter.removeFromAllowlist) {
      allowlistSyncWorker.start(parseInt(process.env.ALLOWLIST_SYNC_INTERVAL_MS ?? "30000", 10))
    }

    // Index on-chain contract events from the real RPC (#1951). The stub adapter has no chain to read.
    const sorobanEventIndexer =
      process.env.SOROBAN_ADAPTER_MODE === "real"
        ? new SorobanEventIndexer({ rpcUrl: sorobanConfig.rpcUrl })
        : null
    void sorobanEventIndexer?.start()

    const server = app.listen(env.PORT, () => {
      logger.info("Backend listening", { port: env.PORT, url: `http://localhost:${env.PORT}` })
    })
    notificationWSS.attach(server)

    let shuttingDown = false
    const shutdown = async (signal: string) => {
      if (shuttingDown) return
      shuttingDown = true
      logger.info("Shutdown signal received, starting graceful shutdown", { signal })

      const forceExitTimer = setTimeout(() => {
        logger.error("Graceful shutdown timed out, forcing exit", { timeoutMs: SHUTDOWN_TIMEOUT_MS })
        fatalExit("Graceful shutdown timed out, forcing exit")
      }, SHUTDOWN_TIMEOUT_MS)
      forceExitTimer.unref()

      try {
        if (backupInterval) clearInterval(backupInterval)
        await reconciliationWorker.stop()
        await rentWalletWorker.stop()
        await allowlistSyncWorker.stop()
        await sorobanEventIndexer?.stop()
        if (outboxWorker) await outboxWorker.stop()
        await notificationWSS.close()
        if (typeof app.locals.shutdownWorkers === "function") {
          await app.locals.shutdownWorkers()
        }
        await shutdownTracing()

        await new Promise<void>((resolve) => {
          server.close((err) => {
            if (err) logger.error("Error closing HTTP server", {}, err)
            resolve()
          })
        })

        await closeDbPools()
        await closeRedis()

        clearTimeout(forceExitTimer)
        logger.info("Graceful shutdown complete")
        process.exit(0)
      } catch (error) {
        clearTimeout(forceExitTimer)
        logger.error("Error during graceful shutdown", {}, error)
        fatalExit("Error during graceful shutdown", error instanceof Error ? error.message : String(error))
      }
    }

    process.on("SIGTERM", () => void shutdown("SIGTERM"))
    process.on("SIGINT", () => void shutdown("SIGINT"))
  } catch (error) {
    logger.error("Fatal startup error", {}, error)
    fatalExit("Fatal startup error", error instanceof Error ? error.message : String(error))
  }
}

void main()
// Closes #1576: Addressed bundle size in backend build configuration
