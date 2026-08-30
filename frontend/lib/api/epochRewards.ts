/**
 * Epoch Rewards API Client
 * 
 * Provides methods to interact with the epoch-based staking rewards API endpoints.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '';

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface EpochInfo {
  epoch_number: number;
  start_ts: number;
  duration_secs: number;
  end_ts: number;
  seal_ts: number;
  sealed: boolean;
  total_rewards: string; // bigint as string
  carried_forward: string; // bigint as string
  reward_index_at_seal: string; // bigint as string
  dust: string; // bigint as string
  total_claimable_at_seal: string; // bigint as string
}

export interface EpochStakeResponse {
  success: boolean;
  txHash: string;
}

export interface EpochUnstakeResponse {
  success: boolean;
  txHash: string;
}

export interface EpochClaimResponse {
  success: boolean;
  claimedAmount: string;
}

export interface EpochClaimableResponse {
  success: boolean;
  claimable: string;
}

export interface EpochInfoResponse {
  success: boolean;
  data: EpochInfo;
}

export interface CurrentEpochResponse {
  success: boolean;
  currentEpoch: number;
}

export interface TotalStakedResponse {
  success: boolean;
  totalStaked: string;
}

/**
 * Stake tokens in the epoch rewards pool.
 * 
 * @param amount - Amount to stake as string (USDC)
 * @returns Promise resolving to the stake response
 * @throws Error if the request fails
 */
export async function epochStake(amount: string): Promise<EpochStakeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/epoch-rewards/stake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount }),
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to stake tokens'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as EpochStakeResponse;
}

/**
 * Unstake tokens from the epoch rewards pool.
 * 
 * @param amount - Amount to unstake as string (USDC)
 * @returns Promise resolving to the unstake response
 * @throws Error if the request fails
 */
export async function epochUnstake(amount: string): Promise<EpochUnstakeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/epoch-rewards/unstake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount }),
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to unstake tokens'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as EpochUnstakeResponse;
}

/**
 * Claim epoch-based rewards.
 * 
 * @returns Promise resolving to the claim response
 * @throws Error if the request fails
 */
export async function epochClaim(): Promise<EpochClaimResponse> {
  const response = await fetch(`${API_BASE_URL}/api/epoch-rewards/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to claim rewards'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as EpochClaimResponse;
}

/**
 * Get claimable epoch rewards amount.
 * 
 * @returns Promise resolving to the claimable amount response
 * @throws Error if the request fails
 */
export async function epochGetClaimable(): Promise<EpochClaimableResponse> {
  const response = await fetch(`${API_BASE_URL}/api/epoch-rewards/claimable`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to fetch claimable amount'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as EpochClaimableResponse;
}

/**
 * Get information about a specific epoch.
 * 
 * @param epochNumber - The epoch number to query
 * @returns Promise resolving to the epoch info response
 * @throws Error if the request fails
 */
export async function epochGetEpoch(epochNumber: number): Promise<EpochInfoResponse> {
  const response = await fetch(`${API_BASE_URL}/api/epoch-rewards/epoch/${epochNumber}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to fetch epoch info'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as EpochInfoResponse;
}

/**
 * Get the current epoch number.
 * 
 * @returns Promise resolving to the current epoch response
 * @throws Error if the request fails
 */
export async function epochGetCurrentEpoch(): Promise<CurrentEpochResponse> {
  const response = await fetch(`${API_BASE_URL}/api/epoch-rewards/current-epoch`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to fetch current epoch'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as CurrentEpochResponse;
}

/**
 * Get total staked amount across all users.
 * 
 * @returns Promise resolving to the total staked response
 * @throws Error if the request fails
 */
export async function epochGetTotalStaked(): Promise<TotalStakedResponse> {
  const response = await fetch(`${API_BASE_URL}/api/epoch-rewards/total-staked`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to fetch total staked'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as TotalStakedResponse;
}

/**
 * Type guard to check if an error is an API error with validation details.
 */
export function isApiError(error: unknown): error is Error & { apiError?: ApiError; statusCode?: number } {
  return error instanceof Error && 'statusCode' in error;
}
