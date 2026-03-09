export class SorobanError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'SorobanError'
  }
}

export class ContractError extends SorobanError {
  constructor(
    message: string,
    public readonly contractId: string,
    public readonly method: string,
    cause?: unknown
  ) {
    super(message, 'CONTRACT_ERROR', cause)
    this.name = 'ContractError'
  }
}

export class DuplicateReceiptError extends SorobanError {
  constructor(
    public readonly txId: string,
    message = `Receipt with tx_id ${txId} already recorded`
  ) {
    super(message, 'DUPLICATE_RECEIPT')
    this.name = 'DuplicateReceiptError'
  }
}

export class RpcError extends SorobanError {
  constructor(
    message: string,
    public readonly status?: number,
    cause?: unknown
  ) {
    super(message, 'RPC_ERROR', cause)
    this.name = 'RpcError'
  }
}

export class ConfigurationError extends SorobanError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR')
    this.name = 'ConfigurationError'
  }
}

export class TransactionError extends SorobanError {
  constructor(
    message: string,
    public readonly txHash?: string,
    public readonly operation?: string,
    cause?: unknown
  ) {
    super(message, 'TRANSACTION_ERROR', cause)
    this.name = 'TransactionError'
  }
}

/**
 * Check if an error is a duplicate receipt error.
 * This handles various ways the contract might signal a duplicate:
 * - Contract-specific error codes
 * - Error messages containing "already" or "duplicate"
 * - Error messages containing the tx_id
 */
export function isDuplicateReceiptError(error: unknown, txId?: string): boolean {
  if (!error) return false

  // Check for our typed error
  if (error instanceof DuplicateReceiptError) return true

  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()

  // Common duplicate indicators in error messages
  const duplicateIndicators = [
    'already exists',
    'duplicate',
    'already recorded',
    'receipt already',
    'entry already',
  ]

  if (duplicateIndicators.some(indicator => lowerMessage.includes(indicator))) {
    return true
  }

  // If txId provided, check if it's mentioned in the error (contract-specific error)
  if (txId) {
    const errorStr = error instanceof Error ? error.message : String(error)
    if (errorStr.includes(txId)) {
      return true
    }
  }

  return false
}

/**
 * Check if an error is a transient RPC error that should be retried
 */
export function isTransientRpcError(error: unknown): boolean {
  if (!error) return false

  const message = error instanceof Error ? error.message : String(error)
  const status = (error as any)?.response?.status

  // HTTP status codes that indicate retryable errors
  if (status === 429 || status === 503 || status === 504) return true

  // Network/transient error indicators
  const transientIndicators = [
    'timeout',
    'econnreset',
    'enotfound',
    'eai_again',
    'rate limit',
    'temporarily',
    'unavailable',
  ]

  return transientIndicators.some(indicator =>
    message.toLowerCase().includes(indicator)
  )
}
