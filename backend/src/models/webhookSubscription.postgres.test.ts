import { describe } from 'vitest'
import { runWebhookStoreContract } from '../test-fixtures/webhookStoreContract.js'

// The same contract as webhookSubscription.test.ts, against a real database.
// Skipped without DATABASE_URL (the tables come from the migrations).
describe.skipIf(!process.env.DATABASE_URL)('webhook stores on Postgres', () => {
  runWebhookStoreContract('postgres')
})
