/**
 * API client for NGN-to-Staking flow
 * Handles quote generation, deposit initiation, and status polling
 */

import { apiFetch } from './api';

// Type definitions
export interface Quote {
  id: string;
  ngnAmount: number;
  usdcAmount: number;
  fxRate: number;
  fees: {
    conversionFee: number;
    platformFee: number;
    total: number;
  };
  expiresAt: string; // ISO 8601 timestamp
  createdAt: string;
}

export interface PaymentInstructions {
  paystackUrl?: string;
  bankDetails?: {
    accountNumber: string;
    accountName: string;
    bankName: string;
    reference: string;
  };
}

export interface StakingPosition {
  amount: number; // USDC
  startDate: string; // ISO 8601
  expectedYield: number; // APY percentage
  maturityDate?: string;
}

export type TransactionStatusType =
  | 'deposit_pending'
  | 'conversion_pending'
  | 'staking_queued'
  | 'confirmed'
  | 'deposit_failed'
  | 'conversion_failed'
  | 'staking_failed';

export interface TransactionStatus {
  transactionId: string;
  status: TransactionStatusType;
  ngnAmount: number;
  usdcAmount?: number;
  stakingPosition?: StakingPosition;
  error?: string;
  updatedAt: string;
}

// Request/Response types
export interface QuoteRequest {
  ngnAmount: number;
}

export interface QuoteResponse {
  success: boolean;
  quote: Quote;
}

export interface DepositInitiationRequest {
  quoteId: string;
  paymentMethod: 'paystack' | 'bank_transfer';
}

export interface DepositInitiationResponse {
  success: boolean;
  transactionId: string;
  paymentInstructions: PaymentInstructions;
}

export interface StatusPollResponse {
  success: boolean;
  status: TransactionStatus;
}

// Custom error class
export class NgnStakingApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'NgnStakingApiError';
  }
}

/**
 * Get a quote for NGN to USDC conversion
 */
export async function getQuote(ngnAmount: number): Promise<Quote> {
  try {
    const response = await apiFetch<QuoteResponse>('/api/staking/ngn/quote', {
      method: 'POST',
      body: JSON.stringify({ ngnAmount }),
    });

    if (!response.success || !response.quote) {
      throw new NgnStakingApiError('Invalid quote response from server');
    }

    return response.quote;
  } catch (error) {
    if (error instanceof NgnStakingApiError) {
      throw error;
    }
    throw new NgnStakingApiError(
      'Failed to fetch quote',
      undefined,
      error
    );
  }
}

/**
 * Initiate a deposit with a locked quote
 */
export async function initiateDeposit(
  quoteId: string,
  paymentMethod: 'paystack' | 'bank_transfer' = 'paystack'
): Promise<DepositInitiationResponse> {
  try {
    const response = await apiFetch<DepositInitiationResponse>(
      '/api/staking/ngn/initiate',
      {
        method: 'POST',
        body: JSON.stringify({ quoteId, paymentMethod }),
      }
    );

    if (!response.success || !response.transactionId) {
      throw new NgnStakingApiError('Invalid deposit initiation response from server');
    }

    return response;
  } catch (error) {
    if (error instanceof NgnStakingApiError) {
      throw error;
    }
    throw new NgnStakingApiError(
      'Failed to initiate deposit',
      undefined,
      error
    );
  }
}

/**
 * Poll for transaction status
 */
export async function getTransactionStatus(
  transactionId: string
): Promise<TransactionStatus> {
  try {
    const response = await apiFetch<StatusPollResponse>(
      `/api/staking/ngn/status/${transactionId}`
    );

    if (!response.success || !response.status) {
      throw new NgnStakingApiError('Invalid status response from server');
    }

    return response.status;
  } catch (error) {
    if (error instanceof NgnStakingApiError) {
      throw error;
    }
    throw new NgnStakingApiError(
      'Failed to fetch transaction status',
      undefined,
      error
    );
  }
}
