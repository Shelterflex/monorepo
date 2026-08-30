import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@stellar/freighter-api', () => ({
  default: {
    isConnected: vi.fn(),
    getAddress: vi.fn(),
    getNetwork: vi.fn(),
    signTransaction: vi.fn(),
  },
}))

import freighterApi from '@stellar/freighter-api'
import { StellarWalletConnection } from '@/lib/stellar-wallet'

const mockedIsConnected = vi.mocked(freighterApi.isConnected) as any
const mockedGetAddress = vi.mocked(freighterApi.getAddress) as any
const mockedGetNetwork = vi.mocked(freighterApi.getNetwork) as any
const mockedSignTransaction = vi.mocked(freighterApi.signTransaction) as any

describe('StellarWalletConnection', () => {
  let wallet: StellarWalletConnection

  beforeEach(() => {
    vi.restoreAllMocks()
    wallet = new StellarWalletConnection()
  })

  describe('connect', () => {
    it('returns wallet info on successful connection', async () => {
      mockedIsConnected.mockReturnValue(true)
      mockedGetAddress.mockResolvedValue({ address: 'GABC123' })
      mockedGetNetwork.mockResolvedValue({ network: 'testnet', networkPassphrase: 'Test SDF Network ; September 2015' })

      const info = await wallet.connect()

      expect(info.publicKey).toBe('GABC123')
      expect(info.network).toBe('testnet')
    })

    it('throws when Freighter is not connected', async () => {
      mockedIsConnected.mockReturnValue(false)

      await expect(wallet.connect()).rejects.toThrow()
    })

    it('defaults to testnet when network cannot be determined', async () => {
      mockedIsConnected.mockReturnValue(true)
      mockedGetAddress.mockResolvedValue({ address: 'GABC123' })
      mockedGetNetwork.mockRejectedValue(new Error('no network'))

      const info = await wallet.connect()

      expect(info.network).toBe('testnet')
    })

    it('throws when public key is empty', async () => {
      mockedIsConnected.mockReturnValue(true)
      mockedGetAddress.mockResolvedValue({ address: '' })

      await expect(wallet.connect()).rejects.toThrow()
    })
  })

  describe('signTransaction', () => {
    it('signs a transaction with the correct passphrase', async () => {
      mockedIsConnected.mockReturnValue(true)
      mockedGetAddress.mockResolvedValue({ address: 'GABC123' })
      mockedGetNetwork.mockResolvedValue({ network: 'testnet', networkPassphrase: 'Test SDF Network ; September 2015' })
      await wallet.connect()

      mockedSignTransaction.mockResolvedValue({ signedTxXdr: 'signed_xdr_123' })

      const result = await wallet.signTransaction('unsigned_xdr')

      expect(result).toBe('signed_xdr_123')
      expect(mockedSignTransaction).toHaveBeenCalledWith('unsigned_xdr', {
        networkPassphrase: 'Test SDF Network ; September 2015',
        address: 'GABC123',
      })
    })

    it('throws when wallet is not connected', async () => {
      await expect(wallet.signTransaction('xdr')).rejects.toThrow('Wallet not connected')
    })

    it('throws when signing fails', async () => {
      mockedIsConnected.mockReturnValue(true)
      mockedGetAddress.mockResolvedValue({ address: 'GABC123' })
      mockedGetNetwork.mockResolvedValue({ network: 'testnet', networkPassphrase: 'Test SDF Network ; September 2015' })
      await wallet.connect()

      mockedSignTransaction.mockResolvedValue({ error: 'user rejected' })

      await expect(wallet.signTransaction('xdr')).rejects.toThrow()
    })
  })

  describe('disconnect', () => {
    it('clears the public key and network', async () => {
      mockedIsConnected.mockReturnValue(true)
      mockedGetAddress.mockResolvedValue({ address: 'GABC123' })
      mockedGetNetwork.mockResolvedValue({ network: 'testnet', networkPassphrase: 'Test' })
      await wallet.connect()

      expect(wallet.isConnected()).toBe(true)

      await wallet.disconnect()

      expect(wallet.isConnected()).toBe(false)
      expect(wallet.getPublicKey()).toBeNull()
      expect(wallet.getNetwork()).toBeNull()
    })
  })

  describe('isConnected', () => {
    it('returns false initially', () => {
      expect(wallet.isConnected()).toBe(false)
    })

    it('returns true after connection', async () => {
      mockedIsConnected.mockReturnValue(true)
      mockedGetAddress.mockResolvedValue({ address: 'GABC123' })
      mockedGetNetwork.mockResolvedValue({ network: 'testnet', networkPassphrase: 'Test' })
      await wallet.connect()

      expect(wallet.isConnected()).toBe(true)
    })
  })

  describe('getPublicKey / getNetwork', () => {
    it('returns null before connection', () => {
      expect(wallet.getPublicKey()).toBeNull()
      expect(wallet.getNetwork()).toBeNull()
    })

    it('returns values after connection', async () => {
      mockedIsConnected.mockReturnValue(true)
      mockedGetAddress.mockResolvedValue({ address: 'GDEF456' })
      mockedGetNetwork.mockResolvedValue({ network: 'public', networkPassphrase: 'Public Global Stellar Network ; September 2015' })
      await wallet.connect()

      expect(wallet.getPublicKey()).toBe('GDEF456')
      expect(wallet.getNetwork()).toBe('public')
    })
  })
})
