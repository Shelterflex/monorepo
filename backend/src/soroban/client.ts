export type SorobanConfig = {
  rpcUrl: string
  networkPassphrase: string
  contractId?: string
}

export function getSorobanConfigFromEnv(env: NodeJS.ProcessEnv): SorobanConfig {
  return {
    rpcUrl: env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase: env.SOROBAN_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    contractId: env.SOROBAN_CONTRACT_ID,
  }
}
