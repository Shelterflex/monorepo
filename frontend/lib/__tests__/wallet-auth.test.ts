import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { WalletAuthManager } from '@/lib/wallet-auth'

vi.mock('@/lib/stellar-wallet', () => ({
  stellarWallet: {
    connect: vi.fn(),
    signTransaction: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(),
    getPublicKey: vi.fn(),
    getNetwork: vi.fn(),
  },
}))

vi.mock('@/lib/authApi', () => ({
  requestWalletChallenge: vi.fn(),
  verifyWalletSignature: vi.fn(),
}))

import { stellarWallet } from '@/lib/stellar-wallet'
import { requestWalletChallenge, verifyWalletSignature } from '@/lib/authApi'

const mockedConnect = vi.mocked(stellarWallet.connect)
const mockedSign = vi.mocked(stellarWallet.signTransaction)
const mockedDisconnect = vi.mocked(stellarWallet.disconnect)
const mockedChallenge = vi.mocked(requestWalletChallenge)
const mockedVerify = vi.mocked(verifyWalletSignature)

function resetSingleton() {
  ;(WalletAuthManager as any).instance = undefined
}

describe('WalletAuthManager', () => {
  let manager: WalletAuthManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.restoreAllMocks()
    localStorage.clear()
    resetSingleton()
    manager = WalletAuthManager.getInstance()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getInstance', () => {
    it('returns the same instance on repeated calls', () => {
      const a = WalletAuthManager.getInstance()
      const b = WalletAuthManager.getInstance()
      expect(a).toBe(b)
    })
  })

  describe('connectAndAuthenticate', () => {
    it('connects wallet, requests challenge, signs, verifies, and returns a session', async () => {
      mockedConnect.mockResolvedValue({ publicKey: 'GABC123', network: 'testnet' })
      mockedChallenge.mockResolvedValue({ challengeXdr: 'xdr-123', expiresAt: '2026-01-01T00:00:00Z' })
      mockedSign.mockResolvedValue('signed-xdr')
      mockedVerify.mockResolvedValue({
        token: 'session-token',
        user: { id: '1', email: 'a@b.com', name: 'A', role: 'tenant' },
      })

      const session = await manager.connectAndAuthenticate()

      expect(session.publicKey).toBe('GABC123')
      expect(session.network).toBe('testnet')
      expect(session.token).toBe('session-token')
      expect(session.expiresAt).toBeGreaterThan(Date.now())
      expect(mockedConnect).toHaveBeenCalledOnce()
      expect(mockedChallenge).toHaveBeenCalledWith('GABC123')
      expect(mockedSign).toHaveBeenCalledWith('xdr-123')
      expect(mockedVerify).toHaveBeenCalledWith('GABC123', 'signed-xdr')
    })

    it('persists session to localStorage', async () => {
      mockedConnect.mockResolvedValue({ publicKey: 'GDEF456', network: 'testnet' })
      mockedChallenge.mockResolvedValue({ challengeXdr: 'xdr-456', expiresAt: '2026-01-01T00:00:00Z' })
      mockedSign.mockResolvedValue('signed-xdr-456')
      mockedVerify.mockResolvedValue({
        token: 'persist-token',
        user: { id: '2', email: 'b@b.com', name: 'B', role: 'landlord' },
      })

      await manager.connectAndAuthenticate()

      const stored = localStorage.getItem('wallet_auth_session')
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored!)
      expect(parsed.token).toBe('persist-token')
    })

    it('throws and does not save session on failure', async () => {
      mockedConnect.mockRejectedValue(new Error('Wallet not found'))

      await expect(manager.connectAndAuthenticate()).rejects.toThrow('Wallet not found')
      expect(localStorage.getItem('wallet_auth_session')).toBeNull()
    })
  })

  describe('disconnect', () => {
    it('clears the session and calls wallet disconnect', async () => {
      mockedConnect.mockResolvedValue({ publicKey: 'GABC', network: 'testnet' })
      mockedChallenge.mockResolvedValue({ challengeXdr: 'x', expiresAt: '2026-01-01T00:00:00Z' })
      mockedSign.mockResolvedValue('signed')
      mockedVerify.mockResolvedValue({
        token: 'tok',
        user: { id: '1', email: 'a@b.com', name: 'A', role: 'tenant' },
      })

      await manager.connectAndAuthenticate()
      expect(manager.isAuthenticated()).toBe(true)

      await manager.disconnect()

      expect(manager.isAuthenticated()).toBe(false)
      expect(mockedDisconnect).toHaveBeenCalledOnce()
      expect(localStorage.getItem('wallet_auth_session')).toBeNull()
    })
  })

  describe('getSession', () => {
    it('returns null when no session exists', () => {
      expect(manager.getSession()).toBeNull()
    })

    it('returns the session when it is valid', async () => {
      mockedConnect.mockResolvedValue({ publicKey: 'GABC', network: 'testnet' })
      mockedChallenge.mockResolvedValue({ challengeXdr: 'x', expiresAt: '2026-01-01T00:00:00Z' })
      mockedSign.mockResolvedValue('signed')
      mockedVerify.mockResolvedValue({
        token: 'tok',
        user: { id: '1', email: 'a@b.com', name: 'A', role: 'tenant' },
      })

      await manager.connectAndAuthenticate()
      const session = manager.getSession()
      expect(session).not.toBeNull()
      expect(session!.token).toBe('tok')
    })

    it('returns null and clears storage when session is expired', async () => {
      mockedConnect.mockResolvedValue({ publicKey: 'GABC', network: 'testnet' })
      mockedChallenge.mockResolvedValue({ challengeXdr: 'x', expiresAt: '2026-01-01T00:00:00Z' })
      mockedSign.mockResolvedValue('signed')
      mockedVerify.mockResolvedValue({
        token: 'tok',
        user: { id: '1', email: 'a@b.com', name: 'A', role: 'tenant' },
      })

      await manager.connectAndAuthenticate()

      vi.advanceTimersByTime(25 * 60 * 60 * 1000)

      expect(manager.getSession()).toBeNull()
      expect(localStorage.getItem('wallet_auth_session')).toBeNull()
    })
  })

  describe('isAuthenticated', () => {
    it('returns false when no session', () => {
      expect(manager.isAuthenticated()).toBe(false)
    })

    it('returns true after successful authentication', async () => {
      mockedConnect.mockResolvedValue({ publicKey: 'GABC', network: 'testnet' })
      mockedChallenge.mockResolvedValue({ challengeXdr: 'x', expiresAt: '2026-01-01T00:00:00Z' })
      mockedSign.mockResolvedValue('signed')
      mockedVerify.mockResolvedValue({
        token: 'tok',
        user: { id: '1', email: 'a@b.com', name: 'A', role: 'tenant' },
      })

      await manager.connectAndAuthenticate()
      expect(manager.isAuthenticated()).toBe(true)
    })
  })

  describe('getAuthToken', () => {
    it('returns null when not authenticated', () => {
      expect(manager.getAuthToken()).toBeNull()
    })

    it('returns the token when authenticated', async () => {
      mockedConnect.mockResolvedValue({ publicKey: 'GABC', network: 'testnet' })
      mockedChallenge.mockResolvedValue({ challengeXdr: 'x', expiresAt: '2026-01-01T00:00:00Z' })
      mockedSign.mockResolvedValue('signed')
      mockedVerify.mockResolvedValue({
        token: 'my-token',
        user: { id: '1', email: 'a@b.com', name: 'A', role: 'tenant' },
      })

      await manager.connectAndAuthenticate()
      expect(manager.getAuthToken()).toBe('my-token')
    })
  })

  describe('refreshIfNeeded', () => {
    it('does nothing when not authenticated', async () => {
      await manager.refreshIfNeeded()
      expect(mockedConnect).not.toHaveBeenCalled()
    })

    it('refreshes when session is within 1 hour of expiry', async () => {
      mockedConnect.mockResolvedValue({ publicKey: 'GABC', network: 'testnet' })
      mockedChallenge.mockResolvedValue({ challengeXdr: 'x', expiresAt: '2026-01-01T00:00:00Z' })
      mockedSign.mockResolvedValue('signed')
      mockedVerify.mockResolvedValue({
        token: 'tok',
        user: { id: '1', email: 'a@b.com', name: 'A', role: 'tenant' },
      })

      await manager.connectAndAuthenticate()

      vi.advanceTimersByTime(23.5 * 60 * 60 * 1000)

      await manager.refreshIfNeeded()

      expect(mockedConnect).toHaveBeenCalledTimes(2)
    })

    it('does not refresh when session has more than 1 hour left', async () => {
      mockedConnect.mockResolvedValue({ publicKey: 'GABC', network: 'testnet' })
      mockedChallenge.mockResolvedValue({ challengeXdr: 'x', expiresAt: '2026-01-01T00:00:00Z' })
      mockedSign.mockResolvedValue('signed')
      mockedVerify.mockResolvedValue({
        token: 'tok',
        user: { id: '1', email: 'a@b.com', name: 'A', role: 'tenant' },
      })

      await manager.connectAndAuthenticate()

      vi.advanceTimersByTime(1 * 60 * 60 * 1000)

      await manager.refreshIfNeeded()

      expect(mockedConnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('session restoration from localStorage', () => {
    it('restores a valid session on initialization', () => {
      const futureTime = Date.now() + 3600000
      localStorage.setItem('wallet_auth_session', JSON.stringify({
        publicKey: 'GSTORED',
        network: 'testnet',
        token: 'stored-token',
        expiresAt: futureTime,
      }))

      resetSingleton()
      const newManager = WalletAuthManager.getInstance()
      expect(newManager.isAuthenticated()).toBe(true)
      expect(newManager.getAuthToken()).toBe('stored-token')
    })

    it('does not restore an expired session', () => {
      localStorage.setItem('wallet_auth_session', JSON.stringify({
        publicKey: 'GSTORED',
        network: 'testnet',
        token: 'expired-token',
        expiresAt: Date.now() - 1000,
      }))

      resetSingleton()
      const newManager = WalletAuthManager.getInstance()
      expect(newManager.isAuthenticated()).toBe(false)
    })

    it('handles corrupted localStorage data gracefully', () => {
      localStorage.setItem('wallet_auth_session', 'not-json')

      resetSingleton()
      const newManager = WalletAuthManager.getInstance()
      expect(newManager.isAuthenticated()).toBe(false)
    })
  })
})
