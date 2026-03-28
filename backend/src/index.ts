import "./tracing.js"
import "dotenv/config"
import { createApp } from "./app.js"
import { maybeStartOutboxWorker } from "./outbox/workerEntry.js"
import { env } from "./schemas/env.js"
import { createRequire } from "node:module"
import { getUsdcTokenAddress } from "./utils/token.js"
import { runMigrationsIfNeeded } from "./migrations/runMigrations.js"

const require = createRequire(import.meta.url)
const { version } = require("../package.json") as { version: string }

// Validate environment before starting the server
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
    await runMigrationsIfNeeded()
    const app = createApp()
    maybeStartOutboxWorker()
    app.listen(env.PORT, () => {
      console.log(`[backend] listening on http://localhost:${env.PORT}`)
    })
  } catch (error) {
    console.error(`[backend] Fatal startup error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exit(1)
  }
}

void main()