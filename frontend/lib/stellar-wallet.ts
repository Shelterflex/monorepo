import freighterApi from '@stellar/freighter-api'

export interface WalletInfo {
  publicKey: string
  network?: string
}

export class StellarWalletConnection {
  private publicKey: string | null = null
  private network: string | null = null

  async connect(): Promise<WalletInfo> {
    if (typeof window === 'undefined') {
      throw new Error('Wallet connection requires browser environment')
    }

    try {
      // Check if Freighter is available
      if (!freighterApi.isConnected()) {
        throw new Error('Freighter wallet not found. Please install Freighter extension.')
      }

      // Request access to user's public key
      const { address: publicKey } = await freighterApi.getAddress()
      
      if (!publicKey) {
        throw new Error('Failed to get public key from Freighter')
      }

      this.publicKey = publicKey
      
      // Get network info
      try {
        const networkDetails = await freighterApi.getNetwork()
        this.network = networkDetails.network
      } catch (networkError) {
        console.warn('Could not determine network:', networkError)
        this.network = 'testnet' // Default to testnet
      }

      return {
        publicKey,
        network: this.network || undefined
      }
    } catch (error) {
      console.error('Stellar wallet connection failed:', error)
      throw new Error('Failed to connect Stellar wallet')
    }
  }

  async signTransaction(xdr: string): Promise<string> {
    if (!this.publicKey) {
      throw new Error('Wallet not connected')
    }

    try {
      const result = await freighterApi.signTransaction(xdr, {
        networkPassphrase: 'Test SDF Network ; September 2015',
        address: this.publicKey,
      })
      
      if (!result || result.error) {
        throw new Error('Failed to sign transaction')
      }

      return result.signedTxXdr
    } catch (error) {
      console.error('Transaction signing failed:', error)
      throw new Error('Failed to sign transaction with Freighter')
    }
  }

  async disconnect(): Promise<void> {
    this.publicKey = null
    this.network = null
  }

  isConnected(): boolean {
    return this.publicKey !== null
  }

  getPublicKey(): string | null {
    return this.publicKey
  }

  getNetwork(): string | null {
    return this.network
  }
}

// Global wallet instance
export const stellarWallet = new StellarWalletConnection()

// Type declaration for Freighter API
declare global {
  interface Window {
    freighter?: {
      isConnected: () => boolean
      getPublicKey: () => Promise<string>
      signTransaction: (xdr: string, publicKey: string, network: string) => Promise<string>
      getNetwork: () => Promise<{ network: string; networkPassphrase: string }>
    }
  }
}
