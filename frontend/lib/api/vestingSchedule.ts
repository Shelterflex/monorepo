/**
 * Vesting Schedule API Client
 * 
 * Provides methods to interact with the vesting schedule API endpoints.
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

export interface VestingSchedule {
  beneficiary: string;
  totalAmount: string; // USDC amount as string
  startTime: number; // Unix timestamp
  endTime: number; // Unix timestamp
  cliffTime: number; // Unix timestamp
  revocable: boolean;
  claimedAmount: string;
  vestedAmount: string;
  claimableAmount: string;
}

export interface ClaimableVestedResponse {
  beneficiary: string;
  claimableAmount: string;
}

export interface ClaimVestedResponse {
  success: boolean;
  beneficiary: string;
  claimedAmount: string;
  message: string;
}

/**
 * Fetches the vesting schedule for a beneficiary.
 * 
 * @param beneficiary - The beneficiary address
 * @returns Promise resolving to the vesting schedule
 * @throws Error if the request fails
 */
export async function getVestingSchedule(
  beneficiary: string
): Promise<VestingSchedule> {
  const response = await fetch(`${API_BASE_URL}/api/vesting-schedule/schedule?beneficiary=${beneficiary}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to fetch vesting schedule'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as VestingSchedule;
}

/**
 * Fetches the claimable vested amount for a beneficiary.
 * 
 * @param beneficiary - The beneficiary address
 * @returns Promise resolving to the claimable amount response
 * @throws Error if the request fails
 */
export async function getClaimableVested(
  beneficiary: string
): Promise<ClaimableVestedResponse> {
  const response = await fetch(`${API_BASE_URL}/api/vesting-schedule/claimable?beneficiary=${beneficiary}`, {
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

  return result as ClaimableVestedResponse;
}

/**
 * Claims vested tokens for a beneficiary.
 * 
 * @param beneficiary - The beneficiary address
 * @returns Promise resolving to the claim response
 * @throws Error if the request fails
 */
export async function claimVested(
  beneficiary: string
): Promise<ClaimVestedResponse> {
  const response = await fetch(`${API_BASE_URL}/api/vesting-schedule/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ beneficiary }),
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to claim vested tokens'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as ClaimVestedResponse;
}

/**
 * Type guard to check if an error is an API error with validation details.
 */
export function isApiError(error: unknown): error is Error & { apiError?: ApiError; statusCode?: number } {
  return error instanceof Error && 'statusCode' in error;
}
