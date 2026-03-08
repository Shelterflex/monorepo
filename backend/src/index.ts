import "dotenv/config"
import { createApp } from "./app.js"
import { env } from "./schemas/env.js"
import { errorHandler } from "./middleware/index.js"
import { AppError } from "./errors/index.js"
import { ErrorCode } from "./errors/index.js"
import { createRequire } from "module"
import { getUsdcTokenAddress } from "./utils/token.js"

const require = createRequire(import.meta.url)
const { version } = require("../package.json") as { version: string }

// Validate environment before starting the server
if (env.NODE_ENV !== 'development') {
  try {
    getUsdcTokenAddress()
    console.log(`[backend] Environment validation passed for ${env.SOROBAN_NETWORK} network`)
  } catch (error) {
    console.error(`[backend] Environment validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    console.error(`[backend] Please check your environment variables and restart the server`)
    process.exit(1)
  }
}

const app = createApp()

app.listen(env.PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.PORT}`)
})