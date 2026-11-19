/**
 * Metrics-tracking wrapper for Soroban adapters
 * 
 * Wraps any SorobanAdapter to automatically track RPC call metrics
 */

import {
  SorobanAdapter,
  RecordReceiptParams,
  MultisigArg,
  MultisigCall,
  MultisigCallParams,
  MultisigConfig,
  MultisigProposal,
  MultisigProposalStatus,
} from './adapter.js';
import { SorobanConfig } from './client.js';
import { RawReceiptEvent } from '../indexer/event-parser.js';
import { recordSorobanRpcCall } from '../utils/metrics.js';

export class MetricsSorobanAdapter implements SorobanAdapter {
  constructor(private readonly wrapped: SorobanAdapter) {}

  async getBalance(account: string): Promise<bigint> {
    return this.trackCall('getBalance', () => this.wrapped.getBalance(account));
  }

  async credit(account: string, amount: bigint): Promise<void> {
    return this.trackCall('credit', () => this.wrapped.credit(account, amount));
  }

  async debit(account: string, amount: bigint): Promise<void> {
    return this.trackCall('debit', () => this.wrapped.debit(account, amount));
  }

  async getStakedBalance(account: string): Promise<bigint> {
    return this.trackCall('getStakedBalance', () => this.wrapped.getStakedBalance(account));
  }

  async getClaimableRewards(account: string): Promise<bigint> {
    return this.trackCall('getClaimableRewards', () => this.wrapped.getClaimableRewards(account));
  }

  async recordReceipt(params: RecordReceiptParams): Promise<void> {
    return this.trackCall('recordReceipt', () => this.wrapped.recordReceipt(params));
  }

  getConfig(): SorobanConfig {
    return this.wrapped.getConfig();
  }

  async getReceiptEvents(fromLedger: number | null): Promise<RawReceiptEvent[]> {
    return this.trackCall('getReceiptEvents', () => this.wrapped.getReceiptEvents(fromLedger));
  }

  async getTimelockEvents(fromLedger: number | null): Promise<any[]> {
    return this.trackCall('getTimelockEvents', () => this.wrapped.getTimelockEvents(fromLedger));
  }

  async executeTimelock(
    txHash: string,
    target: string,
    functionName: string,
    args: any[],
    eta: number
  ): Promise<string> {
    return this.trackCall('executeTimelock', () =>
      this.wrapped.executeTimelock(txHash, target, functionName, args, eta)
    );
  }

  async cancelTimelock(txHash: string): Promise<string> {
    return this.trackCall('cancelTimelock', () => this.wrapped.cancelTimelock(txHash));
  }

  // Optional admin operations
  async pause?(contractId: string): Promise<string> {
    if (!this.wrapped.pause) {
      throw new Error('pause not implemented');
    }
    return this.trackCall('pause', () => this.wrapped.pause!(contractId));
  }

  async unpause?(contractId: string): Promise<string> {
    if (!this.wrapped.unpause) {
      throw new Error('unpause not implemented');
    }
    return this.trackCall('unpause', () => this.wrapped.unpause!(contractId));
  }

  async setOperator?(contractId: string, operatorAddress: string | null): Promise<string> {
    if (!this.wrapped.setOperator) {
      throw new Error('setOperator not implemented');
    }
    return this.trackCall('setOperator', () =>
      this.wrapped.setOperator!(contractId, operatorAddress)
    );
  }

  async init?(
    contractId: string,
    adminAddress: string,
    operatorAddress?: string
  ): Promise<string> {
    if (!this.wrapped.init) {
      throw new Error('init not implemented');
    }
    return this.trackCall('init', () =>
      this.wrapped.init!(contractId, adminAddress, operatorAddress)
    );
  }

  // ── stake_delegation (#1489) ───────────────────────────────────────────────
  // MetricsSorobanAdapter is the outermost wrapper the routes actually hold, so
  // optional methods have to be forwarded here or callers cannot see them.

  async createRentPaymentReceipt?(
    dealId: string,
    amount: bigint,
    payer: string,
    recipient: string,
    timestamp: number,
  ): Promise<string> {
    if (!this.wrapped.createRentPaymentReceipt) {
      throw new Error('createRentPaymentReceipt not implemented');
    }
    return this.trackCall('createRentPaymentReceipt', () =>
      this.wrapped.createRentPaymentReceipt!(dealId, amount, payer, recipient, timestamp),
    );
  }

  // epoch_rewards (#1965) and multisig_admin (#1972)
  multisigTargetFor?(contract: 'dealEscrow' | 'contractAccess'): string | undefined {
    return this.wrapped.multisigTargetFor?.(contract);
  }

  multisigEnabled?(): boolean {
    return this.wrapped.multisigEnabled?.() ?? false;
  }

  multisigContractId?(): string | undefined {
    return this.wrapped.multisigContractId?.();
  }

  async multisigGetConfig?(): Promise<MultisigConfig> {
    if (!this.wrapped.multisigGetConfig) {
      throw new Error('multisigGetConfig not implemented');
    }
    return this.trackCall('multisigGetConfig', () => this.wrapped.multisigGetConfig!());
  }

  async multisigListProposals?(status?: MultisigProposalStatus): Promise<MultisigProposal[]> {
    if (!this.wrapped.multisigListProposals) {
      throw new Error('multisigListProposals not implemented');
    }
    return this.trackCall('multisigListProposals', () => this.wrapped.multisigListProposals!(status));
  }

  async multisigGetProposal?(proposalId: number): Promise<MultisigProposal | null> {
    if (!this.wrapped.multisigGetProposal) {
      throw new Error('multisigGetProposal not implemented');
    }
    return this.trackCall('multisigGetProposal', () => this.wrapped.multisigGetProposal!(proposalId));
  }

  async multisigPropose?(target: string, functionName: string, args: MultisigArg[]): Promise<{ txHash: string; proposalId?: number }> {
    if (!this.wrapped.multisigPropose) {
      throw new Error('multisigPropose not implemented');
    }
    return this.trackCall('multisigPropose', () => this.wrapped.multisigPropose!(target, functionName, args));
  }

  async prepareMultisigCall?(call: MultisigCall, params: MultisigCallParams): Promise<string> {
    if (!this.wrapped.prepareMultisigCall) {
      throw new Error('prepareMultisigCall not implemented');
    }
    return this.trackCall('prepareMultisigCall', () => this.wrapped.prepareMultisigCall!(call, params));
  }

  async submitMultisigCall?(signedXdr: string, call: MultisigCall, params: MultisigCallParams): Promise<string> {
    if (!this.wrapped.submitMultisigCall) {
      throw new Error('submitMultisigCall not implemented');
    }
    return this.trackCall('submitMultisigCall', () => this.wrapped.submitMultisigCall!(signedXdr, call, params));
  }

  /**
   * Helper method to track RPC calls with metrics
   */
  private async trackCall<T>(method: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    let success = true;
    let errorType: string | undefined;

    try {
      const result = await fn();
      return result;
    } catch (error) {
      success = false;
      errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
      throw error;
    } finally {
      const durationMs = Date.now() - start;
      recordSorobanRpcCall(method, durationMs, success, errorType);
    }
  }
}
