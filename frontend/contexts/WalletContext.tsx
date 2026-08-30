"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import {
  isFreighterInstalled,
  isWalletAllowed,
  connectWallet,
  disconnectWallet,
  signTransaction,
  getActiveAddress,
  getWalletNetwork,
  EXPECTED_NETWORK_PASSPHRASE,
} from "@/lib/freighter"

const STORAGE_KEY = "shelterflex_wallet"
const POLL_INTERVAL_MS = 3000

interface WalletContextType {
  publicKey: string | null
  address: string | null
  connected: boolean
  connecting: boolean
  freighterInstalled: boolean
  networkMismatch: boolean
  walletLocked: boolean
  connect: () => Promise<void>
  disconnect: () => void
  signTransaction: (xdr: string) => Promise<string>
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [freighterInstalled, setFreighterInstalled] = useState<boolean | null>(null)
  const [networkMismatch, setNetworkMismatch] = useState(false)
  const [walletLocked, setWalletLocked] = useState(false)

  useEffect(() => {
    // A wallet that is installed and already permitted, but cannot produce an
    // address, is locked — a different problem from "not installed" and from
    // "never connected", and it needs its own instruction.
    void (async () => {
      const installed = await isFreighterInstalled()
      setFreighterInstalled(installed)
      if (!installed) return
      if (await isWalletAllowed()) {
        setWalletLocked((await getActiveAddress()) === null)
      }
    })()

    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (parsed && parsed.publicKey) {
          setPublicKey(parsed.publicKey)
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY)
      }
    }
  }, [])

  // Poll for account/network changes while connected
  useEffect(() => {
    if (!publicKey) return
    const poll = async () => {
      try {
        const installed = await isFreighterInstalled()
        if (!installed) {
          setPublicKey(null)
          setWalletLocked(true)
          localStorage.removeItem(STORAGE_KEY)
          return
        }
        const [currentAddress, networkPassphrase] = await Promise.all([
          getActiveAddress(),
          getWalletNetwork(),
        ])
        if (!currentAddress) {
          setWalletLocked(true)
          return
        }
        setWalletLocked(false)
        if (currentAddress !== publicKey) {
          setPublicKey(currentAddress)
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ publicKey: currentAddress }))
        }
        setNetworkMismatch(networkPassphrase !== "" && networkPassphrase !== EXPECTED_NETWORK_PASSPHRASE)
      } catch {
        setWalletLocked(true)
      }
    }
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [publicKey])

  const connect = useCallback(async () => {
    setConnecting(true)
    try {
      const pk = await connectWallet()
      setPublicKey(pk)
      setWalletLocked(false)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ publicKey: pk }))
      const networkPassphrase = await getWalletNetwork()
      setNetworkMismatch(networkPassphrase !== "" && networkPassphrase !== EXPECTED_NETWORK_PASSPHRASE)
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setPublicKey(null)
    setNetworkMismatch(false)
    setWalletLocked(false)
    disconnectWallet()
  }, [])

  const handleSignTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (networkMismatch) throw new Error("Switch Freighter to Testnet before signing")
      if (walletLocked) throw new Error("Wallet is locked — unlock Freighter to continue")
      return signTransaction(xdr)
    },
    [networkMismatch, walletLocked],
  )

  return (
    <WalletContext.Provider
      value={{
        publicKey,
        address: publicKey,
        connected: publicKey !== null,
        connecting,
        freighterInstalled: freighterInstalled === true,
        networkMismatch,
        walletLocked,
        connect,
        disconnect,
        signTransaction: handleSignTransaction,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider")
  }
  return context
}
