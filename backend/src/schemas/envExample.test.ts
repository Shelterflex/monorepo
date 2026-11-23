import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { envSchema } from './env.js'

const ALLOWED_UNDOCUMENTED_KEYS: readonly string[] = []

const documentedKeys = new Set(
  readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)\s*=/)?.[1])
    .filter((key): key is string => key !== undefined),
)

describe('.env.example coverage', () => {
  it('documents every envSchema key unless explicitly allow-listed', () => {
    const undocumentedKeys = Object.keys(envSchema.innerType().shape).filter(
      (key) => !documentedKeys.has(key) && !ALLOWED_UNDOCUMENTED_KEYS.includes(key),
    )

    expect(undocumentedKeys).toEqual([])
  })
})
