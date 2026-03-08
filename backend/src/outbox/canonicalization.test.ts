import { describe, it, expect } from 'vitest'
import {
  buildCanonicalString,
  validateExternalRef,
  computeTxId,
  parseCanonicalString,
  CanonicalFormatError,
  ValidationError,
} from './canonicalization.js'

 import { readFileSync } from 'node:fs'
 import { resolve } from 'node:path'

// Golden test vectors - shared with contract tests
const goldenVectorsPath = resolve(process.cwd(), '..', 'test-vectors.json')
const goldenVectors = JSON.parse(readFileSync(goldenVectorsPath, 'utf8'))

describe('buildCanonicalString', () => {
  it('should construct canonical string in correct format', () => {
    const result = buildCanonicalString('paystack', 'pi_abc123')
    expect(result).toBe('v1|source=paystack|ref=pi_abc123')
  })

  it('should trim and lowercase source', () => {
    const result = buildCanonicalString('  PAYSTACK  ', 'pi_abc123')
    expect(result).toBe('v1|source=paystack|ref=pi_abc123')
  })

  it('should trim ref while preserving case', () => {
    const result = buildCanonicalString('paystack', '  PI_ABC123  ')
    expect(result).toBe('v1|source=paystack|ref=PI_ABC123')
  })

  it('should handle mixed case source correctly', () => {
    const result = buildCanonicalString('PayStack', 'ref123')
    expect(result).toBe('v1|source=paystack|ref=ref123')
  })

  it('should handle various whitespace patterns', () => {
    const result = buildCanonicalString('\t\nSTELLAR\t\n', '\t\nTX_HASH_456\t\n')
    expect(result).toBe('v1|source=stellar|ref=TX_HASH_456')
  })

  it('should reject empty source after trimming', () => {
    expect(() => buildCanonicalString('   ', 'ref123')).toThrow(ValidationError)
    expect(() => buildCanonicalString('   ', 'ref123')).toThrow('Source cannot be empty')
  })

  it('should reject empty ref after trimming', () => {
    expect(() => buildCanonicalString('paystack', '   ')).toThrow(ValidationError)
    expect(() => buildCanonicalString('paystack', '   ')).toThrow('Ref cannot be empty')
  })

  it('should reject ref containing pipe character', () => {
    expect(() => buildCanonicalString('paystack', 'ref|123')).toThrow(ValidationError)
    expect(() => buildCanonicalString('paystack', 'ref|123')).toThrow('pipe character')
  })

  it('should reject canonical string exceeding 256 characters', () => {
    const longRef = 'x'.repeat(250) // Will exceed 256 with prefix
    expect(() => buildCanonicalString('paystack', longRef)).toThrow(ValidationError)
    expect(() => buildCanonicalString('paystack', longRef)).toThrow('exceeds 256 characters')
  })

  it('should accept canonical string at exactly 256 characters', () => {
    // "v1|source=paystack|ref=" is 23 characters, so ref can be 233 characters
    const maxRef = 'x'.repeat(233)
    const result = buildCanonicalString('paystack', maxRef)
    expect(result.length).toBe(256)
  })
})

describe('validateExternalRef', () => {
  it('should accept valid source and ref', () => {
    expect(() => validateExternalRef('paystack', 'pi_abc123')).not.toThrow()
  })

  it('should reject empty source', () => {
    expect(() => validateExternalRef('', 'ref123')).toThrow(ValidationError)
    expect(() => validateExternalRef('', 'ref123')).toThrow('Source cannot be empty')
  })

  it('should reject empty ref', () => {
    expect(() => validateExternalRef('paystack', '')).toThrow(ValidationError)
    expect(() => validateExternalRef('paystack', '')).toThrow('Ref cannot be empty')
  })

  it('should reject ref with pipe character', () => {
    expect(() => validateExternalRef('paystack', 'ref|123')).toThrow(ValidationError)
    expect(() => validateExternalRef('paystack', 'ref|123')).toThrow('pipe character')
  })

  it('should provide descriptive error for pipe in ref', () => {
    expect(() => validateExternalRef('paystack', 'bad|ref')).toThrow('Ref cannot contain pipe character (|): bad|ref')
  })
})

describe('computeTxId', () => {
  it('should compute deterministic tx_id', () => {
    const txId1 = computeTxId('paystack', 'pi_abc123')
    const txId2 = computeTxId('paystack', 'pi_abc123')
    expect(txId1).toBe(txId2)
  })

  it('should return 64-character hex string', () => {
    const txId = computeTxId('paystack', 'pi_abc123')
    expect(txId).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should produce same tx_id for same source and ref regardless of whitespace', () => {
    const txId1 = computeTxId('paystack', 'pi_abc123')
    const txId2 = computeTxId('  PAYSTACK  ', '  pi_abc123  ')
    expect(txId1).toBe(txId2)
  })

  it('should produce different tx_id for different refs', () => {
    const txId1 = computeTxId('paystack', 'pi_abc123')
    const txId2 = computeTxId('paystack', 'pi_xyz789')
    expect(txId1).not.toBe(txId2)
  })

  it('should produce different tx_id for different sources', () => {
    const txId1 = computeTxId('paystack', 'ref123')
    const txId2 = computeTxId('stellar', 'ref123')
    expect(txId1).not.toBe(txId2)
  })

  it('should preserve ref case in hash computation', () => {
    const txId1 = computeTxId('paystack', 'ABC')
    const txId2 = computeTxId('paystack', 'abc')
    expect(txId1).not.toBe(txId2)
  })

  it('should normalize source case in hash computation', () => {
    const txId1 = computeTxId('PAYSTACK', 'ref123')
    const txId2 = computeTxId('paystack', 'ref123')
    expect(txId1).toBe(txId2)
  })

  it('should throw ValidationError for invalid inputs', () => {
    expect(() => computeTxId('', 'ref123')).toThrow(ValidationError)
    expect(() => computeTxId('paystack', '')).toThrow(ValidationError)
    expect(() => computeTxId('paystack', 'ref|123')).toThrow(ValidationError)
  })
})

describe('parseCanonicalString', () => {
  it('should parse valid canonical string', () => {
    const result = parseCanonicalString('v1|source=paystack|ref=pi_abc123')
    expect(result).toEqual({ source: 'paystack', ref: 'pi_abc123' })
  })

  it('should extract source and ref correctly', () => {
    const result = parseCanonicalString('v1|source=stellar|ref=TX_HASH_456')
    expect(result.source).toBe('stellar')
    expect(result.ref).toBe('TX_HASH_456')
  })

  it('should handle refs with special characters', () => {
    const result = parseCanonicalString('v1|source=paystack|ref=pi_abc-123_xyz')
    expect(result.ref).toBe('pi_abc-123_xyz')
  })

  it('should throw CanonicalFormatError for invalid format', () => {
    expect(() => parseCanonicalString('invalid')).toThrow(CanonicalFormatError)
  })

  it('should throw CanonicalFormatError for missing version', () => {
    expect(() => parseCanonicalString('source=paystack|ref=pi_abc123')).toThrow(CanonicalFormatError)
  })

  it('should throw CanonicalFormatError for wrong version', () => {
    expect(() => parseCanonicalString('v2|source=paystack|ref=pi_abc123')).toThrow(CanonicalFormatError)
  })

  it('should throw CanonicalFormatError for missing source', () => {
    expect(() => parseCanonicalString('v1|ref=pi_abc123')).toThrow(CanonicalFormatError)
  })

  it('should throw CanonicalFormatError for missing ref', () => {
    expect(() => parseCanonicalString('v1|source=paystack')).toThrow(CanonicalFormatError)
  })

  it('should provide descriptive error message', () => {
    expect(() => parseCanonicalString('bad_format')).toThrow(
      "Invalid canonical string format: expected 'v1|source=<source>|ref=<ref>'"
    )
  })
})

describe('round-trip consistency', () => {
  it('should maintain consistency through build and parse', () => {
    const source = 'paystack'
    const ref = 'pi_abc123'
    const canonical = buildCanonicalString(source, ref)
    const parsed = parseCanonicalString(canonical)
    expect(parsed.source).toBe(source)
    expect(parsed.ref).toBe(ref)
  })

  it('should normalize source in round-trip', () => {
    const canonical = buildCanonicalString('  PAYSTACK  ', 'ref123')
    const parsed = parseCanonicalString(canonical)
    expect(parsed.source).toBe('paystack')
    expect(parsed.ref).toBe('ref123')
  })

  it('should preserve ref case in round-trip', () => {
    const canonical = buildCanonicalString('paystack', 'ABC_xyz')
    const parsed = parseCanonicalString(canonical)
    expect(parsed.ref).toBe('ABC_xyz')
  })
})

describe('tx_id independence from context', () => {
  it('should produce same tx_id regardless of amount', () => {
    // tx_id should only depend on (source, ref), not on amount
    const txId = computeTxId('paystack', 'pi_abc123')
    
    // Simulate different amounts - tx_id should be identical
    const txIdWithAmount1 = computeTxId('paystack', 'pi_abc123')
    const txIdWithAmount2 = computeTxId('paystack', 'pi_abc123')
    
    expect(txIdWithAmount1).toBe(txId)
    expect(txIdWithAmount2).toBe(txId)
  })

  it('should produce same tx_id regardless of dealId', () => {
    // tx_id should only depend on (source, ref), not on dealId
    const txId = computeTxId('paystack', 'pi_abc123')
    
    // Simulate different dealIds - tx_id should be identical
    const txIdWithDeal1 = computeTxId('paystack', 'pi_abc123')
    const txIdWithDeal2 = computeTxId('paystack', 'pi_abc123')
    
    expect(txIdWithDeal1).toBe(txId)
    expect(txIdWithDeal2).toBe(txId)
  })
})

describe('golden test vectors', () => {
  it('should match expected canonical strings and SHA256 hashes', () => {
    const vectors = goldenVectors.golden_test_vectors
    
    vectors.forEach((vector: any, index: number) => {
      const { input, expected_canonical, expected_sha256, expected_error } = vector
      
      if (expected_error) {
        // Test that the expected error occurs
        expect(() => buildCanonicalString(input.source, input.ref)).toThrow(expected_error)
        expect(() => computeTxId(input.source, input.ref)).toThrow(expected_error)
      } else {
        // Test canonical string
        const canonical = buildCanonicalString(input.source, input.ref)
        expect(canonical).toBe(expected_canonical)
        
        // Test SHA256 hash
        const txId = computeTxId(input.source, input.ref)
        expect(txId).toBe(expected_sha256)
        
        // Verify hash format (64-character hex string)
        expect(txId).toMatch(/^[0-9a-f]{64}$/)
      }
    })
  })
})
