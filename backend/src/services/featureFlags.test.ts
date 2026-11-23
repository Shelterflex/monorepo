import { describe, it, expect, afterEach, vi } from 'vitest'
import { flagDefaults, type FlagName } from '../config/featureFlags.js'
import { isEnabled, getAllFlags } from './featureFlags.js'

const ALL_FLAGS = Object.keys(flagDefaults) as FlagName[]

/** Clears every FEATURE_FLAG_* override so each test starts from config defaults. */
function clearFlagEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEATURE_FLAG_')) delete process.env[key]
  }
}

describe('featureFlags service', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    clearFlagEnv()
  })

  describe('isEnabled — defaults', () => {
    it.each(ALL_FLAGS)('returns the config default for %s when no env override is set', (flag) => {
      clearFlagEnv()
      expect(isEnabled(flag)).toBe(flagDefaults[flag])
    })

    it('ignores the reserved context argument', () => {
      clearFlagEnv()
      expect(isEnabled('STAKING_ENABLED', { userId: 'u1', role: 'admin' })).toBe(
        flagDefaults.STAKING_ENABLED,
      )
    })
  })

  describe('isEnabled — environment takes precedence over defaults', () => {
    // [env value, expected result]. Only exact "true" and "1" enable a flag.
    const cases: Array<[string, boolean]> = [
      ['true', true],
      ['1', true],
      ['false', false],
      ['0', false],
      ['', false],
      // Invalid values: anything other than "true"/"1" is treated as false.
      ['TRUE', false],
      ['True', false],
      ['yes', false],
      ['on', false],
      [' true', false],
      ['true ', false],
      ['2', false],
    ]

    it.each(cases)('FEATURE_FLAG_STAKING_ENABLED=%j → %s (default true)', (raw, expected) => {
      vi.stubEnv('FEATURE_FLAG_STAKING_ENABLED', raw)
      expect(isEnabled('STAKING_ENABLED')).toBe(expected)
    })

    it.each(cases)('FEATURE_FLAG_RENT_TO_OWN_ENABLED=%j → %s (default false)', (raw, expected) => {
      vi.stubEnv('FEATURE_FLAG_RENT_TO_OWN_ENABLED', raw)
      expect(isEnabled('RENT_TO_OWN_ENABLED')).toBe(expected)
    })

    it('reads the environment at call time, not at import time', () => {
      vi.stubEnv('FEATURE_FLAG_RENT_TO_OWN_ENABLED', 'true')
      expect(isEnabled('RENT_TO_OWN_ENABLED')).toBe(true)
      vi.stubEnv('FEATURE_FLAG_RENT_TO_OWN_ENABLED', 'false')
      expect(isEnabled('RENT_TO_OWN_ENABLED')).toBe(false)
    })

    it('does not match a lowercase env key', () => {
      vi.stubEnv('feature_flag_RENT_TO_OWN_ENABLED', 'true')
      expect(isEnabled('RENT_TO_OWN_ENABLED')).toBe(false)
    })
  })

  describe('isEnabled — unknown flags', () => {
    it('returns undefined (not false) for a flag missing from config', () => {
      // BUG (reported): the FlagName type prevents this at compile time, but a
      // runtime string (e.g. from a query param) yields `undefined`, not `false`.
      expect(isEnabled('DOES_NOT_EXIST' as FlagName)).toBeUndefined()
    })

    it('honours an env override even for an unknown flag', () => {
      vi.stubEnv('FEATURE_FLAG_DOES_NOT_EXIST', 'true')
      expect(isEnabled('DOES_NOT_EXIST' as FlagName)).toBe(true)
    })
  })

  describe('getAllFlags', () => {
    it('returns every configured flag with its default when there are no overrides', () => {
      clearFlagEnv()
      expect(getAllFlags()).toEqual({ ...flagDefaults })
    })

    it('applies env overrides to the snapshot', () => {
      vi.stubEnv('FEATURE_FLAG_STAKING_ENABLED', 'false')
      vi.stubEnv('FEATURE_FLAG_RENT_TO_OWN_ENABLED', '1')
      const flags = getAllFlags()
      expect(flags.STAKING_ENABLED).toBe(false)
      expect(flags.RENT_TO_OWN_ENABLED).toBe(true)
      expect(flags.INSPECTOR_DASHBOARD_ENABLED).toBe(flagDefaults.INSPECTOR_DASHBOARD_ENABLED)
    })

    it('does not include env-only flags that are absent from config', () => {
      vi.stubEnv('FEATURE_FLAG_DOES_NOT_EXIST', 'true')
      const flags = getAllFlags()
      expect(Object.keys(flags).sort()).toEqual([...ALL_FLAGS].sort())
      expect(flags).not.toHaveProperty('DOES_NOT_EXIST')
    })

    it('returns only boolean values, even with invalid overrides', () => {
      vi.stubEnv('FEATURE_FLAG_STAKING_ENABLED', 'garbage')
      for (const value of Object.values(getAllFlags())) {
        expect(typeof value).toBe('boolean')
      }
    })

    it('returns a fresh object that callers cannot use to mutate defaults', () => {
      const a = getAllFlags()
      a.STAKING_ENABLED = !a.STAKING_ENABLED
      expect(getAllFlags().STAKING_ENABLED).toBe(flagDefaults.STAKING_ENABLED)
    })
  })
})
