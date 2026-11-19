import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Account,
  Address,
  Keypair,
  nativeToScVal,
  scValToNative,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'
import { RealSorobanAdapter } from './real-adapter.js'
import type { SorobanConfig } from './client.js'
import { ConfigurationError } from './errors.js'

const PASSPHRASE = 'Test SDF Network ; September 2015'
const EPOCH_ID = StrKey.encodeContract(Buffer.alloc(32, 5))
const MULTISIG_ID = StrKey.encodeContract(Buffer.alloc(32, 6))
const TARGET = StrKey.encodeContract(Buffer.alloc(32, 7))
const admin = Keypair.random()
const wallet = Keypair.random()
const signer2 = Keypair.random()

const config = (over: Partial<SorobanConfig> = {}): SorobanConfig => ({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: PASSPHRASE,
  epochRewardsId: EPOCH_ID,
  multisigAdminId: MULTISIG_ID,
  adminSecret: admin.secret(),
  ...over,
})

interface Internals {
  invokeReadOnly: ReturnType<typeof vi.fn>
  server: Record<string, ReturnType<typeof vi.fn>>
  adminSigningService: { executeAdminOperation: ReturnType<typeof vi.fn> }
}

function build(over: Partial<SorobanConfig> = {}) {
  const adapter = new RealSorobanAdapter(config(over))
  const internals = adapter as unknown as Internals
  internals.invokeReadOnly = vi.fn()
  internals.server = {
    getAccount: vi.fn(async (id: string) => new Account(id, '1')),
    prepareTransaction: vi.fn(async (tx: Transaction) => tx),
    sendTransaction: vi.fn(async () => ({ status: 'PENDING', hash: 'abc123' })),
  }
  internals.adminSigningService = { executeAdminOperation: vi.fn(async () => 'admin-tx-hash') }
  return { adapter, internals }
}

const sc = (value: unknown, type?: string) => nativeToScVal(value as never, type ? ({ type } as never) : undefined)

describe('RealSorobanAdapter multisig_admin (#1972)', () => {
  let adapter: RealSorobanAdapter
  let internals: Internals
  beforeEach(() => {
    ;({ adapter, internals } = build())
  })

  const proposalScVal = (over: Record<string, unknown> = {}) =>
    sc({
      id: 5n,
      proposer: new Address(admin.publicKey()),
      target: new Address(TARGET),
      function: sc('propose_drain', 'symbol'),
      args: [new Address(wallet.publicKey()), 1_000_000n],
      approvals: [new Address(wallet.publicKey())],
      status: 1,
      created_at: 1000n,
      expires_at: 2000n,
      ...over,
    })

  it('is enabled only when MULTISIG_ADMIN_ID is configured', () => {
    expect(adapter.multisigEnabled()).toBe(true)
    expect(adapter.multisigContractId()).toBe(MULTISIG_ID)
    expect(new RealSorobanAdapter(config({ multisigAdminId: undefined })).multisigEnabled()).toBe(false)
  })

  it('reads the signer set and threshold', async () => {
    internals.invokeReadOnly
      .mockResolvedValueOnce(sc([new Address(admin.publicKey()), new Address(wallet.publicKey())]))
      .mockResolvedValueOnce(sc(2, 'u32'))

    expect(await adapter.multisigGetConfig()).toEqual({
      signers: [admin.publicKey(), wallet.publicKey()],
      threshold: 2,
    })
  })

  it('decodes a proposal, with its target, function and JSON-safe arguments', async () => {
    internals.invokeReadOnly.mockResolvedValueOnce(proposalScVal())

    const proposal = await adapter.multisigGetProposal(5)

    expect(proposal).toMatchObject({
      id: 5,
      proposer: admin.publicKey(),
      target: TARGET,
      function: 'propose_drain',
      approvals: [wallet.publicKey()],
      status: 'pending',
      createdAt: 1000,
      expiresAt: 2000,
    })
    // i128 stays a string so the response survives JSON.stringify.
    expect(proposal?.args).toEqual([wallet.publicKey(), '1000000'])
    expect(() => JSON.stringify(proposal)).not.toThrow()
  })

  it.each([
    [2, 'executed'],
    [3, 'cancelled'],
    [4, 'expired'],
  ])('maps contract status %i to %s', async (code, status) => {
    internals.invokeReadOnly.mockResolvedValueOnce(proposalScVal({ status: code }))

    expect((await adapter.multisigGetProposal(5))?.status).toBe(status)
  })

  it('returns null for an unknown proposal', async () => {
    internals.invokeReadOnly.mockRejectedValueOnce(new Error('ProposalNotFound'))

    expect(await adapter.multisigGetProposal(404)).toBeNull()
  })

  it('lists proposals through the contract, passing the status filter as an enum', async () => {
    internals.invokeReadOnly
      .mockResolvedValueOnce(sc([5n, 6n], undefined))
      .mockResolvedValueOnce(proposalScVal({ id: 5n }))
      .mockResolvedValueOnce(proposalScVal({ id: 6n }))

    const proposals = await adapter.multisigListProposals('pending')

    expect(proposals.map((p) => p.id)).toEqual([5, 6])
    const [, method, args] = internals.invokeReadOnly.mock.calls[0]
    expect(method).toBe('list_proposals')
    expect(args[0].switch().name).toBe('scvU32')
    expect(scValToNative(args[0])).toBe(1)
  })

  it('lists without a filter as None', async () => {
    internals.invokeReadOnly.mockResolvedValueOnce(sc([], undefined))

    await adapter.multisigListProposals()

    expect(internals.invokeReadOnly.mock.calls[0][2][0].switch().name).toBe('scvVoid')
  })

  it("files a proposal with the platform key as the proposer and returns the new id", async () => {
    internals.invokeReadOnly
      .mockResolvedValueOnce(sc([8n, 9n], undefined))
      .mockResolvedValueOnce(proposalScVal({ id: 8n }))
      .mockResolvedValueOnce(proposalScVal({ id: 9n }))

    const result = await adapter.multisigPropose(TARGET, 'propose_drain', [
      { type: 'address', value: wallet.publicKey() },
    ])

    const call = internals.adminSigningService.executeAdminOperation.mock.calls[0][0]
    expect(call).toMatchObject({ contractId: MULTISIG_ID, operation: 'propose' })
    expect(scValToNative(call.args[0])).toBe(admin.publicKey())
    expect(scValToNative(call.args[1])).toBe(TARGET)
    expect(scValToNative(call.args[2])).toBe('propose_drain')
    expect(scValToNative(call.args[3])).toEqual([wallet.publicKey()])
    expect(result).toEqual({ txHash: 'admin-tx-hash', proposalId: 9 })
  })

  describe('user-signed calls', () => {
    const signed = async (call: 'propose' | 'approve' | 'revoke_approval' | 'execute', params: object, by = wallet) => {
      const xdrString = await adapter.prepareMultisigCall(call, { signer: wallet.publicKey(), ...params })
      const tx = TransactionBuilder.fromXDR(xdrString, PASSPHRASE) as Transaction
      tx.sign(by)
      return tx.toXDR()
    }

    it.each(['approve', 'revoke_approval', 'execute'] as const)(
      'prepares, validates and broadcasts %s for a proposal',
      async (call) => {
        const signedXdr = await signed(call, { proposalId: 5 })

        const hash = await adapter.submitMultisigCall(signedXdr, call, {
          signer: wallet.publicKey(),
          proposalId: 5,
        })

        expect(hash).toBe('abc123')
      },
    )

    it('prepares and broadcasts a propose with typed arguments', async () => {
      const params = {
        target: TARGET,
        functionName: 'set_threshold',
        args: [{ type: 'u32' as const, value: 3 }],
      }
      const signedXdr = await signed('propose', params)

      const hash = await adapter.submitMultisigCall(signedXdr, 'propose', {
        signer: wallet.publicKey(),
        ...params,
      })

      expect(hash).toBe('abc123')
    })

    it('rejects an approval for a different proposal than the one signed', async () => {
      const signedXdr = await signed('approve', { proposalId: 5 })

      await expect(
        adapter.submitMultisigCall(signedXdr, 'approve', { signer: wallet.publicKey(), proposalId: 6 }),
      ).rejects.toThrow(/arguments do not match/)
      expect(internals.server.sendTransaction).not.toHaveBeenCalled()
    })

    it('rejects an unsigned approval and one signed by the wrong key', async () => {
      const xdrString = await adapter.prepareMultisigCall('approve', { signer: wallet.publicKey(), proposalId: 5 })
      await expect(
        adapter.submitMultisigCall(xdrString, 'approve', { signer: wallet.publicKey(), proposalId: 5 }),
      ).rejects.toThrow(/not signed/)

      const wrong = await signed('approve', { proposalId: 5 }, signer2)
      await expect(
        adapter.submitMultisigCall(wrong, 'approve', { signer: wallet.publicKey(), proposalId: 5 }),
      ).rejects.toThrow(/not signed by the expected wallet/)
    })

    it('rejects an approve submitted as an execute', async () => {
      const signedXdr = await signed('approve', { proposalId: 5 })

      await expect(
        adapter.submitMultisigCall(signedXdr, 'execute', { signer: wallet.publicKey(), proposalId: 5 }),
      ).rejects.toThrow(/is not execute/)
    })

    it('needs a proposal id, or a target and function', async () => {
      await expect(adapter.prepareMultisigCall('approve', { signer: wallet.publicKey() })).rejects.toThrow(/proposal id/)
      await expect(adapter.prepareMultisigCall('propose', { signer: wallet.publicKey() })).rejects.toThrow(/target and function/)
    })
  })
})
