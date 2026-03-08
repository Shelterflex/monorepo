import type { Wallet } from './wallet.js'

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface WalletStore {
  setWallet(accountId: string, balanceNgn: number, updatedAt?: Date): Promise<import('./wallet.js').Wallet>
  listNegative(page?: number, pageSize?: number): Promise<Paginated<import('./wallet.js').Wallet>>
  listAll(page?: number, pageSize?: number): Promise<Paginated<import('./wallet.js').Wallet>>
  clear(): Promise<void>
}

export class InMemoryWalletStore implements WalletStore {
  private wallets = new Map<string, Wallet>()

  async setWallet(accountId: string, balanceNgn: number, updatedAt: Date = new Date()): Promise<Wallet> {
    const wallet: Wallet = { accountId, balanceNgn, updatedAt }
    this.wallets.set(accountId, wallet)
    return wallet
  }

  async listNegative(page = 1, pageSize = 20): Promise<Paginated<Wallet>> {
    const negatives = Array.from(this.wallets.values())
      .filter((w) => w.balanceNgn < 0)
      .sort((a, b) => a.balanceNgn - b.balanceNgn)
    const total = negatives.length
    const totalPages = Math.ceil(total / pageSize) || 1
    const start = (page - 1) * pageSize
    const items = negatives.slice(start, start + pageSize)
    return { items, total, page, pageSize, totalPages }
  }

  async listAll(page = 1, pageSize = 20): Promise<Paginated<Wallet>> {
    const all = Array.from(this.wallets.values()).sort((a, b) => a.accountId.localeCompare(b.accountId))
    const total = all.length
    const totalPages = Math.ceil(total / pageSize) || 1
    const start = (page - 1) * pageSize
    const items = all.slice(start, start + pageSize)
    return { items, total, page, pageSize, totalPages }
  }

  async clear(): Promise<void> {
    this.wallets.clear()
  }
}

export const walletStore = new InMemoryWalletStore()
