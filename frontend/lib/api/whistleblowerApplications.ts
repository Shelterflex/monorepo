/**
 * Whistleblower Applications API Client
 * 
 * Provides methods to interact with the whistleblower signup API endpoints.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '';

export interface WhistleblowerApplicationData {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  linkedinProfile: string;
  facebookProfile: string;
  instagramProfile: string;
}

export interface WhistleblowerApplicationResponse {
  success: boolean;
  application: {
    applicationId: string;
    fullName: string;
    email: string;
    phone: string;
    address: string;
    linkedinProfile: string;
    facebookProfile: string;
    instagramProfile: string;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: string;
    updatedAt: string;
  };
  message: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Submits a new whistleblower application to the backend API.
 * 
 * @param data - The application data from the signup form
 * @returns Promise resolving to the created application
 * @throws Error if the submission fails
 */
export async function submitWhistleblowerApplication(
  data: WhistleblowerApplicationData
): Promise<WhistleblowerApplicationResponse> {
  const response = await fetch(`${API_BASE_URL}/api/whistleblower-applications`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to submit application'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as WhistleblowerApplicationResponse;
}

/**
 * Checks the status of an existing whistleblower application.
 * 
 * @param applicationId - The ID of the application to check
 * @returns Promise resolving to the application status
 */
export async function checkApplicationStatus(applicationId: string): Promise<{
  success: boolean;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  reviewedAt?: string;
  message: string;
}> {
  const response = await fetch(
    `${API_BASE_URL}/api/whistleblower-applications/${applicationId}/status`
  );

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to check application status'
    ) as Error & { statusCode?: number };
    error.statusCode = response.status;
    throw error;
  }

  return result;
}

/**
 * Type guard to check if an error is an API error with validation details.
 */
export function isApiError(error: unknown): error is Error & { apiError?: ApiError; statusCode?: number } {
  return error instanceof Error && 'statusCode' in error;
}

/**
 * Extracts user-friendly validation errors from an API error response.
 */
export function getValidationErrors(error: unknown): Record<string, string> | null {
  if (!isApiError(error) || !error.apiError?.error?.details) {
    return null;
  }
  
  const details = error.apiError.error.details;
  
  if (
    typeof details === 'object' &&
    details !== null &&
    'fieldErrors' in details &&
    typeof details.fieldErrors === 'object' &&
    details.fieldErrors !== null
  ) {
    const errors: Record<string, string> = {};
    for (const [field, messages] of Object.entries(details.fieldErrors as Record<string, unknown>)) {
      if (Array.isArray(messages) && messages.length > 0) {
        const [message] = messages;
        if (typeof message === 'string') {
          errors[field] = message;
        }
      }
    }
    return Object.keys(errors).length > 0 ? errors : null;
  }

  if (typeof details === 'object' && details !== null && !Array.isArray(details)) {
    const errors = Object.fromEntries(
      Object.entries(details).filter(([, value]) => typeof value === 'string')
    ) as Record<string, string>;

    return Object.keys(errors).length > 0 ? errors : null;
  }
  
  return null;
}

/**
 * Whistleblower Earnings API Client
 */

export interface ClaimableRewardResponse {
  whistleblower: string;
  claimableAmount: string;
}

export interface ClaimRewardResponse {
  success: boolean;
  whistleblower: string;
  claimedAmount: string;
  message: string;
}

export interface EarningsTotals {
  totalNgn: number;
  pendingNgn: number;
  paidNgn: number;
  totalUsdc?: number;
  pendingUsdc?: number;
  paidUsdc?: number;
}

export interface EarningsHistoryItem {
  rewardId: string;
  listingId: string;
  dealId: string;
  amountNgn: number;
  amountUsdc: number;
  status: 'pending' | 'payable' | 'paid';
  createdAt: string;
  paidAt?: string;
  onChainAllocated?: boolean;
}

export interface EarningsResponse {
  totals: EarningsTotals;
  history: EarningsHistoryItem[];
}

/**
 * Fetches earnings data for a specific whistleblower.
 * 
 * @param whistleblowerId - The ID of the whistleblower
 * @returns Promise resolving to the earnings response
 * @throws Error if the request fails
 */
export async function getWhistleblowerEarnings(
  whistleblowerId: string
): Promise<EarningsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/whistleblower/${whistleblowerId}/earnings`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to fetch earnings'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as EarningsResponse;
}

/**
 * Fetches the claimable on-chain reward amount for a whistleblower.
 * 
 * @param whistleblowerId - The ID of the whistleblower
 * @returns Promise resolving to the claimable reward response
 * @throws Error if the request fails
 */
export async function getClaimableReward(
  whistleblowerId: string
): Promise<ClaimableRewardResponse> {
  const response = await fetch(`${API_BASE_URL}/api/whistleblower-rewards/claimable?whistleblower=${whistleblowerId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to fetch claimable reward'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as ClaimableRewardResponse;
}

/**
 * Claims an allocated on-chain reward for a whistleblower.
 * 
 * @param whistleblowerId - The ID of the whistleblower
 * @returns Promise resolving to the claim reward response
 * @throws Error if the request fails
 */
export async function claimReward(
  whistleblowerId: string
): Promise<ClaimRewardResponse> {
  const response = await fetch(`${API_BASE_URL}/api/whistleblower-rewards/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ whistleblower: whistleblowerId }),
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Failed to claim reward'
    ) as Error & { apiError?: ApiError; statusCode?: number };
    error.apiError = result as ApiError;
    error.statusCode = response.status;
    throw error;
  }

  return result as ClaimRewardResponse;
}
