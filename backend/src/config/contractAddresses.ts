import { StrKey } from '@stellar/stellar-sdk'

export const CONTRACT_ENV_VARS = {
  core: 'SOROBAN_CONTRACT_ID',
  rentPayments: 'SOROBAN_RENT_PAYMENTS_ID',
  dealEscrow: 'SOROBAN_DEAL_ESCROW_ID',
  rewardDistribution: 'SOROBAN_REWARD_DISTRIBUTION_ID',
  whistleblowerValidation: 'SOROBAN_WHISTLEBLOWER_VALIDATION_ID',
  whistleblowerRewards: 'SOROBAN_WHISTLEBLOWER_REWARDS_ID',
  stakingPool: 'SOROBAN_STAKING_POOL_ID',
  stakingRewards: 'SOROBAN_STAKING_REWARDS_ID',
  mvpStakingPool: 'SOROBAN_MVP_STAKING_POOL_ID',
  stakeDelegation: 'SOROBAN_STAKE_DELEGATION_ID',
  timelock: 'SOROBAN_TIMELOCK_ID',
  inspectorBond: 'SOROBAN_INSPECTOR_BOND_ID',
  tenantReputation: 'SOROBAN_TENANT_REPUTATION_ID',
  usdcToken: 'SOROBAN_USDC_TOKEN_ID',
  contractAccess: 'SOROBAN_CONTRACT_ACCESS_ID',
  upgradeableProxy: 'SOROBAN_UPGRADEABLE_PROXY_ID',
  rentToOwn: 'SOROBAN_RENT_TO_OWN_ID',
  oraclePriceFeeds: 'SOROBAN_ORACLE_PRICE_FEEDS_ID',
  transactionReceipt: 'SOROBAN_TRANSACTION_RECEIPT_ID',
  allowlistRegistry: 'SOROBAN_ALLOWLIST_REGISTRY_ID',
  epochRewards: 'SOROBAN_EPOCH_REWARDS_ID',
  rentWallet: 'SOROBAN_RENT_WALLET_ID',
  slashingModule: 'SOROBAN_SLASHING_MODULE_ID',
  bondCollateral: 'SOROBAN_BOND_COLLATERAL_ID',
  // Stake-weighted parameter governance (contracts/governance). Distinct from
  // `timelock` above — the timelock contract merely uses "governance" as its
  // event-topic namespace and is an unrelated feature.
  governance: 'SOROBAN_GOVERNANCE_ID',
  // Linear vesting with cliff (contracts/vesting_schedule)
  vestingSchedule: 'SOROBAN_VESTING_SCHEDULE_ID',
} as const

export type ContractName = keyof typeof CONTRACT_ENV_VARS
export type ContractAddresses = Readonly<Record<ContractName, string | undefined>>

export function loadContractAddresses(
  env: NodeJS.ProcessEnv,
): ContractAddresses {
  return Object.fromEntries(
    Object.entries(CONTRACT_ENV_VARS).map(([name, envVar]) => {
      const raw = env[envVar]?.trim()
      if (!raw) return [name, undefined]
      if (!StrKey.isValidContract(raw)) {
        throw new Error(
          `Invalid Soroban contract ID in ${envVar}: expected a valid Stellar contract StrKey (C...).`,
        )
      }
      return [name, raw]
    }),
  ) as unknown as ContractAddresses
}

export const contractAddresses = loadContractAddresses(process.env)

export function getContractAddresses(): string[] {
  return Object.values(contractAddresses).filter(
    (address): address is string => address !== undefined,
  )
}
