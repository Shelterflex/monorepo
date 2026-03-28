/**
 * Frontend Feature Flags
 * 
 * Used to gate experimental UI features without backend dependency.
 * Toggle these values to enable/disable features in development or production.
 */
export const featureFlags = {
  /**
   * Enables experimental staking rewards visualization in the dashboard.
   */
  enableExperimentalStaking: false,

  /**
   * Enables advanced wallet operations like filtered CSV exports.
   */
  enableAdvancedWalletOps: false,
} as const;

export type FeatureFlags = typeof featureFlags;
