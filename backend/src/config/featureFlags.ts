/**
 * Feature Flag Definitions
 *
 * Single source of truth for all feature flags.
 * To add a new flag: add one entry here — nothing else needs to change.
 *
 * Runtime env override: set FEATURE_FLAG_<FLAG_NAME>=true to override the
 * default value at process start without modifying this file.
 */
export const flagDefaults = {
  /** Staking rewards deposits, positions, and claims. */
  STAKING_ENABLED: true,

  /** Inspector job listing, claiming, and report submission. */
  INSPECTOR_DASHBOARD_ENABLED: true,

  /** Governance proposal creation, voting, and execution. */
  GOVERNANCE_ENABLED: false,

  /** Rent-to-own plan selector and equity calculator (coming soon). */
  RENT_TO_OWN_ENABLED: false,

  /** Advanced wallet operations: filtered CSV exports, batch ops. */
  ADVANCED_WALLET_OPS_ENABLED: false,

  /** Backend health status indicator in the UI. */
  BACKEND_HEALTH_INDICATOR_ENABLED: false,
} as const

export type FlagName = keyof typeof flagDefaults

/**
 * Flags returned to guest (unauthenticated) callers of GET /api/config/feature-flags.
 * Do not include flags that reveal internal implementation details.
 */
export const GUEST_VISIBLE_FLAGS: readonly FlagName[] = [
  'STAKING_ENABLED',
  'RENT_TO_OWN_ENABLED',
  'BACKEND_HEALTH_INDICATOR_ENABLED',
]

/**
 * Flags returned to authenticated non-admin users.
 * Currently all flags are safe to expose to authenticated users.
 */
export const AUTH_VISIBLE_FLAGS: readonly FlagName[] = Object.keys(
  flagDefaults,
) as FlagName[]
