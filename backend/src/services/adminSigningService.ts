import { Keypair, TransactionBuilder, Operation, xdr, Address, rpc } from '@stellar/stellar-sdk'
import { logger } from '../utils/logger.js'
import { ConfigurationError, TransactionError } from '../soroban/errors.js'

/**
 * Admin operations that require admin signing.
 * These operations have elevated privileges and should be carefully controlled.
 */
export type AdminOperation = 
  | 'pause'
  | 'unpause'
  | 'set_operator'
  | 'init'
  | 'execute'
  | 'cancel'

/**
 * Parameters for admin operations
 */
export interface AdminOperationParams {
  contractId: string
  operation: AdminOperation
  args: xdr.ScVal[]
  networkPassphrase: string
  adminSecret: string
  server: rpc.Server
}

/**
 * Audit log entry for admin operations (no secrets included)
 */
export interface AdminOperationAuditLog {
  timestamp: string
  operation: AdminOperation
  contractId: string
  adminPublicKey: string
  transactionHash?: string
  success: boolean
  error?: string
}

/**
 * Service for handling admin-signed operations on Soroban contracts.
 * 
 * This service isolates admin signing behind a clear boundary and enforces:
 * - Feature flag check (SOROBAN_ADMIN_SIGNING_ENABLED)
 * - Audit logging for all operations
 * - Explicit operation whitelist
 * 
 * Best practices:
 * - Admin secrets should NOT be used in general request handlers
 * - Admin operations should be triggered by admin-only endpoints or background jobs
 * - All admin operations are logged for audit purposes
 */
export class AdminSigningService {
  private readonly enabled: boolean
  private readonly adminSecret?: string
  private readonly networkPassphrase: string
  private readonly server: rpc.Server

  constructor(config: {
    enabled: boolean
    adminSecret?: string
    networkPassphrase: string
    server: rpc.Server
  }) {
    this.enabled = config.enabled
    this.adminSecret = config.adminSecret
    this.networkPassphrase = config.networkPassphrase
    this.server = config.server
  }

  /**
   * Check if admin signing is enabled and configured
   */
  isEnabled(): boolean {
    return this.enabled && !!this.adminSecret
  }

  /**
   * Execute an admin operation with proper checks and audit logging
   */
  async executeAdminOperation(params: AdminOperationParams): Promise<string> {
    // Check feature flag
    if (!this.enabled) {
      throw new ConfigurationError(
        'Admin signing is disabled. Set SOROBAN_ADMIN_SIGNING_ENABLED=true to enable.'
      )
    }

    if (!this.adminSecret) {
      throw new ConfigurationError(
        'SOROBAN_ADMIN_SECRET not configured. Admin operations require admin secret key.'
      )
    }

    // Validate operation is in whitelist
    const allowedOperations: AdminOperation[] = ['pause', 'unpause', 'set_operator', 'init', 'execute', 'cancel']
    if (!allowedOperations.includes(params.operation)) {
      throw new ConfigurationError(
        `Operation "${params.operation}" is not in the admin operations whitelist. ` +
        `Allowed operations: ${allowedOperations.join(', ')}`
      )
    }

    // Load admin keypair
    let adminKeypair: Keypair
    try {
      adminKeypair = Keypair.fromSecret(this.adminSecret)
    } catch (err) {
      throw new ConfigurationError('Invalid admin secret key configured')
    }

    const adminPublicKey = adminKeypair.publicKey()

    // Audit log: operation initiated (no secrets)
    this.logAdminOperation({
      timestamp: new Date().toISOString(),
      operation: params.operation,
      contractId: params.contractId,
      adminPublicKey,
      success: false, // Will be updated on success
    })

    try {
      // Get the admin's account info from the network
      const accountResponse = await this.server.getAccount(adminPublicKey)

      // Build the transaction
      const tx = new TransactionBuilder(
        accountResponse,
        {
          fee: '100', // BASE_FEE as string
          networkPassphrase: this.networkPassphrase,
        }
      )
      .addOperation(
        Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeInvokeContract(
            new xdr.InvokeContractArgs({
              contractAddress: Address.fromString(params.contractId).toScAddress(),
              functionName: params.operation,
              args: params.args,
            })
          ),
          auth: [],
        })
      )
      .setTimeout(30)
      .build()

      // Sign the transaction
      tx.sign(adminKeypair)

      // Submit the transaction
      const response = await this.server.sendTransaction(tx)

      if (response.status !== 'PENDING') {
        const errorResult = response as any
        const resultXdr = errorResult.errorResultXdr

        // Audit log: operation failed
        this.logAdminOperation({
          timestamp: new Date().toISOString(),
          operation: params.operation,
          contractId: params.contractId,
          adminPublicKey,
          transactionHash: response.hash,
          success: false,
          error: `Transaction failed with status: ${response.status}`,
        })

        throw new TransactionError(
          `Admin operation ${params.operation} failed with status: ${response.status}`,
          response.hash,
          params.operation
        )
      }

      // Wait for transaction confirmation
      const confirmedTx = await this.waitForTransaction(response.hash)

      if (!confirmedTx) {
        // Audit log: timeout
        this.logAdminOperation({
          timestamp: new Date().toISOString(),
          operation: params.operation,
          contractId: params.contractId,
          adminPublicKey,
          transactionHash: response.hash,
          success: false,
          error: 'Transaction not confirmed within timeout',
        })

        throw new TransactionError(
          `Admin operation ${params.operation} not confirmed within timeout`,
          response.hash,
          params.operation
        )
      }

      if (confirmedTx.status === 'SUCCESS') {
        // Audit log: operation succeeded
        this.logAdminOperation({
          timestamp: new Date().toISOString(),
          operation: params.operation,
          contractId: params.contractId,
          adminPublicKey,
          transactionHash: response.hash,
          success: true,
        })

        return response.hash
      } else {
        // Audit log: operation failed
        this.logAdminOperation({
          timestamp: new Date().toISOString(),
          operation: params.operation,
          contractId: params.contractId,
          adminPublicKey,
          transactionHash: response.hash,
          success: false,
          error: `Transaction failed: ${confirmedTx.status}`,
        })

        throw new TransactionError(
          `Admin operation ${params.operation} failed: ${confirmedTx.status}`,
          response.hash,
          params.operation
        )
      }
    } catch (err) {
      // Audit log: operation error
      this.logAdminOperation({
        timestamp: new Date().toISOString(),
        operation: params.operation,
        contractId: params.contractId,
        adminPublicKey,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })

      // Re-throw known errors
      if (err instanceof ConfigurationError || err instanceof TransactionError) {
        throw err
      }

      // Wrap unknown errors
      throw new TransactionError(
        `Admin operation ${params.operation} failed`,
        undefined,
        params.operation,
        err
      )
    }
  }

  /**
   * Wait for a transaction to be confirmed
   */
  private async waitForTransaction(
    txHash: string,
    maxAttempts: number = 30,
    pollIntervalMs: number = 1000
  ): Promise<{ status: string } | null> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, pollIntervalMs))

      try {
        const result = await this.server.getTransaction(txHash)

        if (result.status === 'SUCCESS' || result.status === 'FAILED') {
          return { status: result.status }
        }
        // Status is still PENDING, continue polling
      } catch (err) {
        // If transient error, continue polling
        if (this.isTransientRpcError(err)) {
          continue
        }
        throw err
      }
    }

    return null // Timeout
  }

  /**
   * Check if an RPC error is transient and should be retried
   */
  private isTransientRpcError(err: any): boolean {
    if (!err) return false
    const message = err.message?.toLowerCase() || ''
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('econnrefused') ||
      message.includes('econnreset')
    )
  }

  /**
   * Log admin operation for audit purposes (no secrets)
   */
  private logAdminOperation(log: AdminOperationAuditLog): void {
    logger.info('Admin operation executed', {
      timestamp: log.timestamp,
      operation: log.operation,
      contractId: log.contractId,
      adminPublicKey: log.adminPublicKey,
      transactionHash: log.transactionHash,
      success: log.success,
      error: log.error,
    })
  }
}
