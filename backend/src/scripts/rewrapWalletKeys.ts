import { envSchema } from '../schemas/env.js'
import { PostgresWalletStore } from '../models/walletStore.js'
import { KeyringEncryptionService, readEncryptionKeyringFromEnv } from '../services/walletService.js'

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {}
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue
    const [k, v] = raw.slice(2).split('=', 2)
    args[k] = v === undefined ? true : v
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const fromKeyId = typeof args.fromKeyId === 'string' ? args.fromKeyId : undefined
  const toKeyIdArg = typeof args.toKeyId === 'string' ? args.toKeyId : undefined
  const limit = typeof args.limit === 'string' ? Number(args.limit) : 250
  const cursorUserId = typeof args.cursorUserId === 'string' ? args.cursorUserId : undefined
  const dryRun = args.dryRun === true
  const maxBatches = typeof args.maxBatches === 'string' ? Number(args.maxBatches) : undefined

  if (!fromKeyId) {
    throw new Error('Missing required --fromKeyId=ENCRYPTION_KEY_V1')
  }
  if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) {
    throw new Error('--limit must be between 1 and 1000')
  }

  envSchema.parse(process.env)

  const keyring = readEncryptionKeyringFromEnv(process.env as Record<string, string | undefined>)
  const encryptionService = new KeyringEncryptionService(keyring)
  const toKeyId = toKeyIdArg ?? encryptionService.getCurrentKeyId()

  const store = new PostgresWalletStore()

  let cursor = cursorUserId
  let processed = 0
  let updated = 0
  let skipped = 0
  let failures = 0
  let batches = 0

  process.stdout.write(
    JSON.stringify({
      eventType: 'WALLET_KEY_REWRAP_BATCH_STARTED',
      timestamp: new Date().toISOString(),
      fromKeyId,
      toKeyId,
      limit,
      cursorUserId: cursor ?? null,
      dryRun,
    }) + '\n',
  )

  while (true) {
    if (maxBatches !== undefined && batches >= maxBatches) break
    batches += 1

    const { userIds, nextCursorUserId } = await store.listUserIdsByKeyId(fromKeyId, limit, cursor)
    if (userIds.length === 0) {
      cursor = nextCursorUserId
      break
    }

    for (const userId of userIds) {
      processed += 1
      try {
        const record = await store.getEncryptedKey(userId)
        if (!record) {
          skipped += 1
          continue
        }
        if (record.keyId !== fromKeyId) {
          skipped += 1
          continue
        }
        if (record.keyId === toKeyId) {
          skipped += 1
          continue
        }

        const cipherTextBuf = Buffer.from(record.cipherText, 'base64')
        const plaintext = await encryptionService.decrypt(cipherTextBuf, record.keyId)
        const { cipherText: newCipherTextBuf } = await encryptionService.encrypt(plaintext, toKeyId)

        if (!dryRun) {
          await store.updateEncryption(userId, newCipherTextBuf.toString('base64'), toKeyId)
        }

        updated += 1

        process.stdout.write(
          JSON.stringify({
            eventType: 'WALLET_KEY_REWRAPPED',
            timestamp: new Date().toISOString(),
            userId,
            fromKeyId,
            toKeyId,
            dryRun,
          }) + '\n',
        )
      } catch (e) {
        failures += 1
        const reason = e instanceof Error ? e.message : String(e)
        process.stdout.write(
          JSON.stringify({
            eventType: 'WALLET_KEY_REWRAP_FAILED',
            timestamp: new Date().toISOString(),
            userId,
            fromKeyId,
            toKeyId,
            dryRun,
            reason,
          }) + '\n',
        )
      }
    }

    cursor = nextCursorUserId
    if (!cursor) break
  }

  process.stdout.write(
    JSON.stringify({
      eventType: 'WALLET_KEY_REWRAP_BATCH_COMPLETED',
      timestamp: new Date().toISOString(),
      fromKeyId,
      toKeyId,
      limit,
      nextCursorUserId: cursor ?? null,
      processed,
      updated,
      skipped,
      failures,
      dryRun,
    }) + '\n',
  )

  if (failures > 0) {
    process.exitCode = 2
  }
}

main().catch((err) => {
  process.stderr.write(String(err instanceof Error ? err.stack ?? err.message : err) + '\n')
  process.exitCode = 1
})
