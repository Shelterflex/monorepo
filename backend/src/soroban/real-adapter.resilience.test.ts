import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RealSorobanAdapter } from './real-adapter.js'
import type { SorobanConfig } from './client.js'
import { ContractError } from './errors.js'

const mocks = vi.hoisted(() => ({
  simulateTransaction: vi.fn(),
  getLatestLedger: vi.fn(),
  getEvents: vi.fn(),
  getAccount: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
}))

vi.mock('@stellar/stellar-sdk', async () => {
  const actual = await vi.importActual<typeof import('@stellar/stellar-sdk')>('@stellar/stellar-sdk')

  class MockServer {
    constructor(public readonly url: string) {}

    getLatestLedger = mocks.getLatestLedger
    getEvents = mocks.getEvents
    simulateTransaction = mocks.simulateTransaction
    getAccount = mocks.getAccount
    sendTransaction = mocks.sendTransaction
    getTransaction = mocks.getTransaction
  }

  const makeAddress = (value: string) => ({
    toScAddress: vi.fn().mockReturnValue({}),
    toString: () => value,
  })

  return {
    ...actual,
    rpc: {
      Server: MockServer,
      Api: {
        isSimulationSuccess: vi.fn().mockReturnValue(true),
        isSimulationRestore: vi.fn().mockReturnValue(false),
      },
    },
    Address: Object.assign(
      function AddressMock(value: string) {
        return makeAddress(value)
      },
      {
        fromString: vi.fn().mockImplementation((value: string) => makeAddress(value)),
      },
    ),
    nativeToScVal: vi.fn().mockImplementation((value: unknown) => value),
    scValToNative: vi.fn().mockReturnValue(0n),
    Account: vi.fn().mockImplementation((address: string, sequence: string) => ({
      accountId: () => address,
      sequenceNumber: () => sequence,
    })),
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({}),
      sign: vi.fn().mockReturnThis(),
    })),
    Operation: {
      invokeHostFunction: vi.fn().mockReturnValue({}),
    },
    Keypair: {
      fromSecret: vi.fn().mockReturnValue({
        publicKey: () => 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      }),
    },
  }
})

describe('RealSorobanAdapter RPC resilience', () => {
  const config: SorobanConfig = {
    rpcUrl: 'http://stubbed-rpc.invalid',
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB2CH',
    usdcTokenId: 'CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD5A6',
    adminSecret: 'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAccount.mockResolvedValue({
      accountId: () => 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      sequenceNumber: () => '1',
    })
  })

  it('surfaces an unavailable RPC endpoint as a contract error instead of returning a balance', async () => {
    mocks.simulateTransaction.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const adapter = new RealSorobanAdapter(config)

    await expect(adapter.getBalance('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')).rejects.toBeInstanceOf(ContractError)
    expect(mocks.simulateTransaction).toHaveBeenCalledTimes(1)
  })

  it('surfaces an RPC timeout without treating the read as successful', async () => {
    mocks.simulateTransaction.mockRejectedValueOnce(new Error('RPC request timed out after 30000ms'))

    const adapter = new RealSorobanAdapter(config)

    await expect(adapter.getBalance('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')).rejects.toThrow('timed out')
    expect(mocks.simulateTransaction).toHaveBeenCalledTimes(1)
  })

  it('surfaces an RPC error response without manufacturing a balance', async () => {
    mocks.simulateTransaction.mockRejectedValueOnce(new Error('Gateway timeout'))

    const adapter = new RealSorobanAdapter(config)

    await expect(adapter.getBalance('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')).rejects.toThrow('Gateway timeout')
    expect(mocks.simulateTransaction).toHaveBeenCalledTimes(1)
  })
})
