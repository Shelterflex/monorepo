import { createHash } from 'node:crypto'
import { TxType, type CanonicalExternalRefV1 } from './types.js'

/**
 * Canonicalization rules for transaction IDs
 * 
 * Ensures idempotency by computing deterministic tx_id from external references.
 * The contract will reject duplicate tx_id, making retries safe.
 * 
 * Rules:
 * 1. Normalize the external reference (trim, lowercase source prefix)
 * 2. Combine with tx type and payload hash
 * 3. Generate SHA-256 hash as BytesN<32>
 */

interface CanonicalInput {
  txType: TxType
  externalRef: CanonicalExternalRefV1
  payload: Record<string, unknown>
}

/**
 * Compute deterministic transaction ID (BytesN<32> as hex)
 * 
 * @param input - Transaction type, external reference, and payload
 * @returns 32-byte hash as hex string (64 characters)
 */
export function computeTxId(input: CanonicalInput): string {
  const { txType, externalRef, payload } = input

  // Normalize external reference
  const normalized = normalizeExternalRef(externalRef)

  // Create canonical representation
  const canonical = {
    txType,
    externalRef: normalized,
    // Sort payload keys for deterministic hashing
    payload: sortObjectKeys(payload),
  }

  // Compute SHA-256 hash
  const hash = createHash('sha256')
  hash.update(JSON.stringify(canonical))
  return hash.digest('hex')
}

/**
 * Normalize external reference for consistent hashing
 */
function normalizeExternalRef(ref: CanonicalExternalRefV1): string {
  const trimmed = ref.trim()
  
  // Validate format: source:id
  if (!trimmed.includes(':')) {
    throw new Error(`Invalid external reference format: ${ref}. Expected "source:id"`)
  }

  const [source, ...idParts] = trimmed.split(':')
  const id = idParts.join(':') // Handle IDs that contain colons
  
  if (!source || !id) {
    throw new Error(`Invalid external reference format: ${ref}. Expected "source:id"`)
  }

  // Lowercase source, preserve ID case
  return `${source.toLowerCase()}:${id}`
}

/**
 * Sort object keys recursively for deterministic serialization
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys)
  }

  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(obj).sort()
  
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key])
  }

  return sorted
}

/**
 * Validate external reference format
 */
export function validateExternalRef(ref: CanonicalExternalRefV1): boolean {
  try {
    normalizeExternalRef(ref)
    return true
  } catch {
    return false
  }
}
