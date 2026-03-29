import { describe, it, expect } from 'vitest'
import { withRetry } from './retry.js'

describe('withRetry', () => {
  it('returns immediately on success', async () => {
    const result = await withRetry(async () => 42)
    expect(result).toBe(42)
  })

  it('retries on transient errors and succeeds', async () => {
    let attempt = 0
    const result = await withRetry(
      async () => {
        attempt++
        if (attempt < 3) throw new Error('ECONNRESET')
        return 'ok'
      },
      { maxAttempts: 3, baseDelayMs: 10 },
    )
    expect(result).toBe('ok')
    expect(attempt).toBe(3)
  })

  it('throws after exhausting retries', async () => {
    await expect(
      withRetry(
        async () => {
          throw new Error('ECONNRESET')
        },
        { maxAttempts: 2, baseDelayMs: 10 },
      ),
    ).rejects.toThrow('ECONNRESET')
  })

  it('does not retry permanent errors', async () => {
    let attempt = 0
    await expect(
      withRetry(
        async () => {
          attempt++
          throw new Error('Invalid input')
        },
        { maxAttempts: 3, baseDelayMs: 10 },
      ),
    ).rejects.toThrow('Invalid input')
    expect(attempt).toBe(1) // Only one attempt, no retries
  })

  it('respects custom shouldRetry predicate', async () => {
    let attempt = 0
    const result = await withRetry(
      async () => {
        attempt++
        if (attempt < 2) throw new Error('custom-retryable')
        return 'done'
      },
      {
        maxAttempts: 3,
        baseDelayMs: 10,
        shouldRetry: (err) => err instanceof Error && err.message === 'custom-retryable',
      },
    )
    expect(result).toBe('done')
    expect(attempt).toBe(2)
  })
})
