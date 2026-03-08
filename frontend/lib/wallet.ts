import { BrowserProvider } from 'ethers'

export interface WalletInfo {
  address: string
  chainId?: number
}

export class WalletConnection {
  private provider: BrowserProvider | null = null

  async connect(): Promise<WalletInfo> {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('MetaMask or compatible wallet not found')
    }

    try {
      // Request account access
      await window.ethereum.request({ method: 'eth_requestAccounts' })
      
      // Create provider and get signer
      this.provider = new BrowserProvider(window.ethereum)
      const signer = await this.provider.getSigner()
      const address = await signer.getAddress()
      const network = await this.provider.getNetwork()

      return {
        address: address.toLowerCase(),
        chainId: Number(network.chainId)
      }
    } catch (error) {
      console.error('Wallet connection failed:', error)
      throw new Error('Failed to connect wallet')
    }
  }

  async signMessage(message: string): Promise<string> {
    if (!this.provider) {
      throw new Error('Wallet not connected')
    }

    try {
      const signer = await this.provider.getSigner()
      return await signer.signMessage(message)
    } catch (error) {
      console.error('Message signing failed:', error)
      throw new Error('Failed to sign message')
    }
  }

  async disconnect(): Promise<void> {
    this.provider = null
  }

  isConnected(): boolean {
    return this.provider !== null
  }

  getAddress(): string | null {
    if (!this.provider) return null
    // We could cache the address, but for now we'll just return null
    // and require reconnection to get the address
    return null
  }
}

// Global wallet instance
export const wallet = new WalletConnection()

// Type declaration for window.ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>
      on: (event: string, handler: (...args: any[]) => void) => void
      removeListener: (event: string, handler: (...args: any[]) => void) => void
    }
  }
}
