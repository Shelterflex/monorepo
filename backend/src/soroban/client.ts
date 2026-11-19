import { loadContractAddresses } from '../config/contractAddresses.js'

export type SorobanConfig = {
  rpcUrl: string
  networkPassphrase: string
  contractId?: string
  timelockId?: string
  stakingPoolId?: string
  stakingRewardsId?: string
  mvpStakingPoolId?: string
  usdcTokenId?: string
  dealEscrowId?: string
  rentPaymentsId?: string
  contractAccessId?: string
  rentToOwnId?: string
  transactionReceiptId?: string
  allowlistRegistryId?: string
  rentWalletId?: string
  multisigAdminId?: string
  whistleblowerRewardsId?: string
  adminSecret?: string
  seed?: string | number
}

export function getSorobanConfigFromEnv(env: NodeJS.ProcessEnv): SorobanConfig {
  const addresses = loadContractAddresses(env)
  return {
    rpcUrl: env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase: env.SOROBAN_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    contractId: addresses.core,
    timelockId: addresses.timelock,
    stakingPoolId: addresses.stakingPool,
    stakingRewardsId: addresses.stakingRewards,
    mvpStakingPoolId: addresses.mvpStakingPool,
    usdcTokenId: addresses.usdcToken,
    dealEscrowId: addresses.dealEscrow,
    rentPaymentsId: addresses.rentPayments,
    contractAccessId: addresses.contractAccess,
    rentToOwnId: addresses.rentToOwn,
    transactionReceiptId: addresses.transactionReceipt,
    allowlistRegistryId: addresses.allowlistRegistry,
    rentWalletId: addresses.rentWallet,
    multisigAdminId: addresses.multisigAdmin,
    whistleblowerRewardsId: addresses.whistleblowerRewards,
    adminSecret: env.SOROBAN_ADMIN_SECRET,
    seed: env.SOROBAN_STUB_SEED,
  }
}
