export type SorobanConfig = {
  rpcUrl: string
  networkPassphrase: string
  contractId?: string
  stakingPoolId?: string
  stakingRewardsId?: string
  usdcTokenId?: string
  adminSecret?: string
  seed?: string | number
}

export function getSorobanConfigFromEnv(env: NodeJS.ProcessEnv): SorobanConfig {
  return {
    rpcUrl: env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase: env.SOROBAN_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    contractId: env.SOROBAN_CONTRACT_ID,
    stakingPoolId: env.SOROBAN_STAKING_POOL_ID,
    stakingRewardsId: env.SOROBAN_STAKING_REWARDS_ID,
    usdcTokenId: env.SOROBAN_USDC_TOKEN_ID,
    adminSecret: env.SOROBAN_ADMIN_SECRET,
    seed: env.SOROBAN_STUB_SEED,
  }
}
