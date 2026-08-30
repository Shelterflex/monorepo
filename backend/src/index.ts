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
import { startBackupJob } from "./jobs/backupJob.js"
import { ReconciliationWorker } from "./reconciliation/index.js"
import { notificationWSS } from "./services/websocket/NotificationWebSocketServer.js"
import { loadContractAddresses } from "./config/contractAddresses.js"
import { RentWalletWorker } from "./workers/rentWalletWorker.js"
import { createSorobanAdapter } from "./soroban/index.js"
import { getSorobanConfigFromEnv } from "./soroban/client.js"
import { closeDbPools } from "./db.js"
import { closeRedis } from "./utils/redis.js"

const SHUTDOWN_TIMEOUT_MS = 20_000

const require = createRequire(import.meta.url)
const { version } = require("../package.json") as { version: string }

// WEBHOOK_KEY and SECURE_CONFIG are validated by envSchema (see schemas/env.ts);
// envSchema.parse() already throws/exits before this module runs if either is missing.

if (env.NODE_ENV === 'production') {
  try {
    getUsdcTokenAddress()
    console.log(`[backend] Environment validation passed for ${env.SOROBAN_NETWORK} network`)
  } catch (error) {
    console.error(`[backend] Environment validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    console.error(`[backend] Please check your environment variables and restart the server`)
    process.exit(1)
  }
}

async function main() {
  try {
    loadContractAddresses(process.env)
    validatePiiEncryptionKey(env.ENCRYPTION_KEY, env.NODE_ENV)
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

    const server = app.listen(env.PORT, () => {
      console.log(`[backend] listening on http://localhost:${env.PORT}`)
    })
    notificationWSS.attach(server)

    let shuttingDown = false
    const shutdown = async (signal: string) => {
      if (shuttingDown) return
      shuttingDown = true
      console.log(`[backend] ${signal} received, starting graceful shutdown`)

      const forceExitTimer = setTimeout(() => {
        console.error("[backend] Graceful shutdown timed out, forcing exit")
        process.exit(1)
      }, SHUTDOWN_TIMEOUT_MS)
      forceExitTimer.unref()

      try {
        if (backupInterval) clearInterval(backupInterval)
        await reconciliationWorker.stop()
        await rentWalletWorker.stop()
        if (outboxWorker) await outboxWorker.stop()
        await notificationWSS.close()
        if (typeof app.locals.shutdownWorkers === "function") {
          await app.locals.shutdownWorkers()
        }
        await shutdownTracing()

        await new Promise<void>((resolve) => {
          server.close((err) => {
            if (err) console.error("[backend] Error closing HTTP server:", err)
            resolve()
          })
        })

        await closeDbPools()
        await closeRedis()

        clearTimeout(forceExitTimer)
        console.log("[backend] Graceful shutdown complete")
        process.exit(0)
      } catch (error) {
        clearTimeout(forceExitTimer)
        console.error(`[backend] Error during graceful shutdown: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
        process.exit(1)
      }
    }

    process.on("SIGTERM", () => void shutdown("SIGTERM"))
    process.on("SIGINT", () => void shutdown("SIGINT"))
  } catch (error) {
    console.error(`[backend] Fatal startup error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exit(1)
  }
}

void main()
// Closes #1576: Addressed bundle size in backend build configuration
