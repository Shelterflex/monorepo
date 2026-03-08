export interface Wallet {
  accountId: string
  balanceNgn: number
  updatedAt: Date
}

export type WalletStore = {
  setWallet(accountId: string, balanceNgn: number, updatedAt?: Date): Promise<Wallet>
  listNegative(page?: number, pageSize?: number): Promise<{
    items: Wallet[]
    total: number
    page: number
    pageSize: number
    totalPages: number
  }>
  listAll(page?: number, pageSize?: number): Promise<{
    items: Wallet[]
    total: number
    page: number
    pageSize: number
    totalPages: number
  }>
  clear(): Promise<void>
}
