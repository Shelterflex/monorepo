/**
 * NgnStakingFlow - Main orchestrator component for NGN-to-staking flow
 * Manages the state machine and coordinates between child components
 */

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { QuoteDisplay } from './QuoteDisplay';
import { DepositInstructions } from './DepositInstructions';
import { StatusTracker } from './StatusTracker';
import { ErrorDisplay } from './ErrorDisplay';
import { usePolling } from '@/hooks/use-polling';
import {
  type Quote,
  type StakingPosition,
  type PaymentInstructions,
  type TransactionStatus as TransactionStatusType,
  initiateDeposit,
  getTransactionStatus,
  NgnStakingApiError,
} from '@/lib/ngnStakingApi';
import type { ErrorInfo } from './ErrorDisplay';
import { Loader2 } from 'lucide-react';

// Flow stages
type FlowStage =
  | 'quote_display'
  | 'deposit_initiating'
  | 'deposit_pending'
  | 'conversion_pending'
  | 'staking_queued'
  | 'confirmed'
  | 'error';

// Main flow state
interface NgnStakingFlowState {
  stage: FlowStage;
  quote: Quote | null;
  transactionId: string | null;
  paymentInstructions: PaymentInstructions | null;
  paymentMethod: 'paystack' | 'bank_transfer';
  currentStatus: TransactionStatusType | null;
  stakingPosition: StakingPosition | null;
  error: ErrorInfo | null;
}

export interface NgnStakingFlowProps {
  initialQuote?: Quote;
  onComplete: (position: StakingPosition) => void;
  onCancel: () => void;
}

export function NgnStakingFlow({
  initialQuote,
  onComplete,
  onCancel,
}: Readonly<NgnStakingFlowProps>) {
  // Initialize state
  const [state, setState] = useState<NgnStakingFlowState>({
    stage: 'quote_display',
    quote: initialQuote || null,
    transactionId: null,
    paymentInstructions: null,
    paymentMethod: 'paystack',
    currentStatus: null,
    stakingPosition: null,
    error: null,
  });

  // Polling configuration
  const pollingConfig = {
    initialInterval: 2000,
    maxInterval: 10000,
    backoffMultiplier: 2,
    maxRetries: 5,
    stopOnStatuses: ['confirmed', 'conversion_failed', 'staking_failed', 'deposit_failed'],
    enabled: state.stage === 'deposit_pending' || 
             state.stage === 'conversion_pending' || 
             state.stage === 'staking_queued',
  };

  // Polling hook
  const { data: pollingData, error: pollingError } = usePolling(
    async () => {
      if (!state.transactionId) {
        throw new Error('No transaction ID available');
      }
      const status = await getTransactionStatus(state.transactionId);
      return { data: status, status: status.status };
    },
    pollingConfig
  );

  // Handle polling data updates - derive state changes from polling data
  const latestStatus = pollingData;
  const latestError = pollingError;

  useEffect(() => {
    if (!latestStatus) return;

    const status = latestStatus;
    
    // Batch all state updates into a single setState call
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(prev => {
      // Skip if already in error state from polling error
      if (prev.stage === 'error' && latestError) return prev;

      const updates: Partial<NgnStakingFlowState> = {
        currentStatus: status,
      };

      // Handle status transitions
      switch (status.status) {
        case 'deposit_pending':
          if (prev.stage !== 'deposit_pending') {
            updates.stage = 'deposit_pending';
          }
          break;

        case 'conversion_pending':
          if (prev.stage !== 'conversion_pending') {
            updates.stage = 'conversion_pending';
          }
          break;

        case 'staking_queued':
          if (prev.stage !== 'staking_queued') {
            updates.stage = 'staking_queued';
          }
          break;

        case 'confirmed':
          if (status.stakingPosition) {
            updates.stage = 'confirmed';
            updates.stakingPosition = status.stakingPosition;
            // Call onComplete callback
            setTimeout(() => onComplete(status.stakingPosition!), 0);
          }
          break;

        case 'deposit_failed':
          updates.stage = 'error';
          updates.error = {
            type: 'deposit_failed',
            message: status.error || 'We couldn\'t confirm your deposit. Please try again or contact support.',
            transactionId: status.transactionId,
            canRetry: true,
          };
          break;

        case 'conversion_failed':
          updates.stage = 'error';
          updates.error = {
            type: 'conversion_failed',
            message: status.error || 'Currency conversion failed. Please contact support with your transaction reference.',
            transactionId: status.transactionId,
            canRetry: false,
          };
          break;

        case 'staking_failed':
          updates.stage = 'error';
          updates.error = {
            type: 'staking_failed',
            message: status.error || 'Staking failed. Your USDC is safe. Please contact support to complete staking.',
            transactionId: status.transactionId,
            canRetry: false,
          };
          break;
      }

      return { ...prev, ...updates };
    });
  }, [latestStatus, latestError, onComplete]);

  // Handle polling errors
  useEffect(() => {
    if (latestError && state.stage !== 'error') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(prev => ({
        ...prev,
        stage: 'error',
        error: {
          type: 'network_error',
          message: 'Connection error. Please check your internet and try again.',
          transactionId: prev.transactionId || undefined,
          canRetry: true,
        },
      }));
    }
  }, [latestError, state.stage]);

  // Handle quote confirmation
  const handleConfirmQuote = useCallback(async (quote: Quote) => {
    try {
      // Set loading state
      setState(prev => ({ ...prev, stage: 'deposit_initiating', quote }));

      // Call deposit initiation API
      const response = await initiateDeposit(quote.id, state.paymentMethod);

      // Transition to deposit pending with payment instructions
      setState(prev => ({
        ...prev,
        stage: 'deposit_pending',
        transactionId: response.transactionId,
        paymentInstructions: response.paymentInstructions,
      }));
    } catch (error) {
      // Handle error
      const errorMessage = error instanceof NgnStakingApiError
        ? error.message
        : 'Failed to initiate deposit';

      setState(prev => ({
        ...prev,
        stage: 'error',
        error: {
          type: 'deposit_failed',
          message: errorMessage,
          canRetry: true,
        },
      }));
    }
  }, [state.paymentMethod]);

  // Handle retry from error state
  const handleRetry = useCallback(() => {
    setState(prev => ({
      ...prev,
      stage: 'quote_display',
      error: null,
    }));
  }, []);

  // Handle contact support
  const handleContactSupport = useCallback(() => {
    // Open support contact (could be email, chat, etc.)
    window.open('mailto:support@example.com', '_blank');
  }, []);

  // Render based on current stage
  switch (state.stage) {
    case 'quote_display':
      if (!state.quote) {
        return (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No quote available. Please generate a quote first.</p>
          </div>
        );
      }
      return (
        <QuoteDisplay
          quote={state.quote}
          onConfirm={handleConfirmQuote}
          onCancel={onCancel}
        />
      );

    case 'deposit_initiating':
      return (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-lg font-medium">Initiating deposit...</p>
          </div>
        </div>
      );

    case 'deposit_pending':
      if (!state.transactionId || !state.paymentInstructions) {
        return null;
      }
      return (
        <DepositInstructions
          transactionId={state.transactionId}
          paymentMethod={state.paymentMethod}
          instructions={state.paymentInstructions}
        />
      );

    case 'conversion_pending':
    case 'staking_queued':
      if (!state.transactionId) {
        return null;
      }
      return (
        <StatusTracker
          status={state.stage === 'conversion_pending' ? 'conversion_pending' : 'staking_queued'}
          transactionId={state.transactionId}
        />
      );

    case 'confirmed':
      if (!state.transactionId || !state.stakingPosition) {
        return null;
      }
      return (
        <StatusTracker
          status="confirmed"
          transactionId={state.transactionId}
          stakingPosition={state.stakingPosition}
        />
      );

    case 'error':
      if (!state.error) {
        return null;
      }
      return (
        <ErrorDisplay
          error={state.error}
          onRetry={state.error.canRetry ? handleRetry : undefined}
          onContactSupport={handleContactSupport}
        />
      );

    default:
      return null;
  }
}
