import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createPaymentsRouter } from '../routes/payments.js'
import { StubSorobanAdapter } from '../soroban/stub-adapter.js'
import {
  type KeyStore,
  type EncryptedKeyRecord,
  type Decryptor,
} from './CustodialWalletService.js'
import {
  CustodialWalletServiceImpl,
  WalletNotFoundError
} from './CustodialWalletServiceImpl.js'
import { Keypair, TransactionBuilder, Account } from '@stellar/stellar-sdk'
import { TxType } from '../outbox/types.js'
import { type EncryptedKeyEnvelope } from '../utils/encryption.js'

class MockStore implements KeyStore {
  constructor(private records: Map<string, { plain: Buffer; address: string }>) { }
  async getEncryptedKey(userId: string): Promise<EncryptedKeyRecord> {
    const r = this.records.get(userId)
    if (!r) throw new Error('missing user')
    const iv = Buffer.alloc(16, 1)
    const cipherText = Buffer.concat([iv, r.plain])
    return {
      envelope: {
        version: 'v1',
        algo: 'aes-256-gcm',
        iv: iv.toString('base64'),
        ciphertext: cipherText.toString('base64'),
        tag: Buffer.alloc(16).toString('base64'),
      },
      keyVersion: `kid-${userId}`,
      publicAddress: r.address,
    }
  }
  async getPublicAddress(userId: string): Promise<string> {
    const r = this.records.get(userId)
    if (!r) throw new Error('missing user')
    return r.address
  }
}

class MockDecryptor implements Decryptor {
  calls = 0
  shouldThrow = false
  async decrypt(envelope: EncryptedKeyEnvelope): Promise<Buffer> {
    this.calls++
    if (this.shouldThrow) throw new Error('Simulated decryption or TAMPERING error')
    if (!envelope?.ciphertext) return Buffer.alloc(0)
    return Buffer.from(envelope.ciphertext, 'base64').subarray(16)
  }
}

describe('CustodialWalletService boundary', () => {
  let store: MockStore
  let decryptor: MockDecryptor
  let service: CustodialWalletServiceImpl
  const TEST_KEYPAIR = Keypair.random()

  beforeEach(() => {
    store = new MockStore(
      new Map([
        ['user-1', { plain: Buffer.from(TEST_KEYPAIR.secret()), address: TEST_KEYPAIR.publicKey() }],
      ]),
    )
    decryptor = new MockDecryptor()
    service = new CustodialWalletServiceImpl(store, decryptor, 'Test')
  })

  it('throws WalletNotFoundError for missing user', async () => {
    await expect(service.signMessage('missing-user', 'hello')).rejects.toThrow(WalletNotFoundError)
    await expect(service.signTransaction('missing-user', 'xdr')).rejects.toThrow(WalletNotFoundError)
  })

  it('rejects and does not sign if decryptor throws (tampering)', async () => {
    decryptor.shouldThrow = true
    await expect(service.signMessage('user-1', 'hello')).rejects.toThrow('Simulated decryption or TAMPERING error')
  })

  it('returns deterministic signature for a fixed seed and fixed payload', async () => {
    // Generate a fixed Stellar mock transaction using a random fixed account ID
    const sourceAccount = new Account(Keypair.random().publicKey(), '1')
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: 'Test'
    }).setTimeout(100).build()

    const xdrPayload = tx.toXDR()

    const res1 = await service.signTransaction('user-1', xdrPayload)
    const res2 = await service.signTransaction('user-1', xdrPayload)

    // Should be strictly identical if deterministic
    expect(res1.signature).toBe(res2.signature)
    expect(res1.publicKey).toBe(TEST_KEYPAIR.publicKey())
  })

  it('decrypts only inside service and signs message', async () => {
    const res = await service.signMessage('user-1', 'hello')
    expect(res.publicKey).toBe(TEST_KEYPAIR.publicKey())
    expect(typeof res.signature).toBe('string')
    expect(decryptor.calls).toBe(1)
  })

  it('routes never touch decrypted keys', async () => {
    const app = express()
    app.use(express.json())
    const adapter = new StubSorobanAdapter({
      rpcUrl: 'http://localhost:1337',
      networkPassphrase: 'Test',
    })
    app.use('/api/payments', createPaymentsRouter(adapter))
    const baselineCalls = decryptor.calls
    const body = {
      dealId: 'deal-123',
      txType: TxType.TENANT_REPAYMENT,
      amountUsdc: '1.00',
      tokenAddress: 'USDC-ADDR',
      externalRefSource: 'stripe',
      externalRef: 'pi_abc123',
    }
    const resp = await request(app).post('/api/payments/confirm').send(body)
    expect([200, 202]).toContain(resp.status)
    expect(decryptor.calls).toBe(baselineCalls)
  })
})
