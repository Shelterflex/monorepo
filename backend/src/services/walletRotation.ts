import { env } from '../schemas/env.js'

export type MasterKeyVersion = 1 | 2

export interface WalletEncryptionEnvelope {
  encryptionVersion: MasterKeyVersion
  kekKeyId: string
}

export interface WalletRecord {
  id: string
  encryptionVersion: MasterKeyVersion
}

export interface WalletStore {
  listByEncryptionVersion(version: MasterKeyVersion, limit: number): Promise<WalletRecord[]>
  rewrapWalletDek(walletId: string, fromVersion: MasterKeyVersion, toVersion: MasterKeyVersion): Promise<boolean>
}

export function getActiveMasterKeyVersion(): MasterKeyVersion {
  const v = env.CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION
  if (v !== 1 && v !== 2) {
    throw new Error(`Unsupported custodial wallet encryption version: ${v}`)
  }
  return v
}
