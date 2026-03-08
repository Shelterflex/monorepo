import { createHash } from 'node:crypto'

/**
 * Canonicalization rules for transaction IDs
 * 
 * Ensures idempotency by computing deterministic tx_id from external references.
 * The contract will reject duplicate tx_id, making retries safe.
 * 
 * Canonical Format: "v1|source=<source>|ref=<ref>"
 * 
 * Rules:
 * 1. source: trimmed and lowercased
 * 2. ref: trimmed, case preserved
 * 3. ref must not contain pipe character (|)
 * 4. Total canonical string length must be ≤ 256 characters
 * 5. tx_id = SHA-256(UTF-8 bytes of canonical string)
 * 
 * This implementation matches the Soroban smart contract's generate_tx_id function
 * to ensure consistent tx_id values across backend and on-chain components.
 */

export class CanonicalFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalFormatError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Build canonical external reference string
 * 
 * @param source - Payment source (e.g., "paystack", "stellar")
 * @param ref - External payment reference ID
 * @returns Canonical string in format "v1|source=<source>|ref=<ref>"
 * @throws ValidationError if validation fails
 */
export function buildCanonicalString(source: string, ref: string): string {
  // Normalize source: trim and lowercase
  const normalizedSource = source.trim().toLowerCase()
  
  // Normalize ref: trim, preserve case
  const normalizedRef = ref.trim()
  
  // Validate inputs
  validateExternalRef(normalizedSource, normalizedRef)
  
  // Construct canonical string
  const canonical = `v1|source=${normalizedSource}|ref=${normalizedRef}`
  
  // Validate total length
  if (canonical.length > 256) {
    throw new ValidationError(
      `Canonical string exceeds 256 characters: ${canonical.length} characters`
    )
  }
  
  return canonical
}

/**
 * Validate external reference components
 * 
 * @param source - Payment source (already normalized: trimmed and lowercased)
 * @param ref - External reference (already normalized: trimmed)
 * @throws ValidationError with descriptive message if validation fails
 */
export function validateExternalRef(source: string, ref: string): void {
  // Validate source is not empty
  if (source.length === 0) {
    throw new ValidationError('Source cannot be empty after trimming')
  }
  
  // Validate ref is not empty
  if (ref.length === 0) {
    throw new ValidationError('Ref cannot be empty after trimming')
  }
  
  // Validate ref does not contain pipe character
  if (ref.includes('|')) {
    throw new ValidationError(`Ref cannot contain pipe character (|): ${ref}`)
  }
}

/**
 * Compute deterministic transaction ID from canonical external reference
 * 
 * @param source - Payment source (e.g., "paystack", "stellar")
 * @param ref - External payment reference ID
 * @returns 32-byte SHA-256 hash as hex string (64 characters)
 * @throws ValidationError if validation fails
 */
export function computeTxId(source: string, ref: string): string {
  // Build canonical string (includes validation)
  const canonical = buildCanonicalString(source, ref)
  
  // Convert to UTF-8 bytes and compute SHA-256 hash
  const hash = createHash('sha256')
  hash.update(canonical, 'utf8')
  return hash.digest('hex')
}

/**
 * Parse canonical external reference string
 * 
 * @param canonical - Canonical string to parse
 * @returns Object with source and ref components
 * @throws CanonicalFormatError if format is invalid
 */
export function parseCanonicalString(canonical: string): { source: string; ref: string } {
  // Validate format structure
  const pattern = /^v1\|source=([^|]+)\|ref=(.+)$/
  const match = canonical.match(pattern)
  
  if (!match) {
    throw new CanonicalFormatError(
      `Invalid canonical string format: expected 'v1|source=<source>|ref=<ref>', got '${canonical}'`
    )
  }
  
  const [, source, ref] = match
  
  return { source, ref }
}
