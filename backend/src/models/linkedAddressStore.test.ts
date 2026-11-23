import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryLinkedAddressStore,
  PostgresLinkedAddressStore,
  type LinkedAddressStore,
} from './linkedAddressStore.js'

const ADDR_A = 'gaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const ADDR_B = 'gbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

/**
 * Behaviour every LinkedAddressStore implementation must share. Addresses are
 * lowercase on purpose: the Postgres implementation normalises case on write,
 * so a mixed-case round trip is the one place the two are allowed to differ.
 */
function linkedAddressStoreContract(name: string, createStore: () => LinkedAddressStore, enabled = true) {
  describe.skipIf(!enabled)(`LinkedAddressStore contract: ${name}`, () => {
    let store: LinkedAddressStore

    beforeEach(async () => {
      store = createStore()
      await store.clear()
    })

    describe('setLinkedAddress / getLinkedAddress', () => {
      it('links an address and reads it back', async () => {
        await store.setLinkedAddress('user-1', ADDR_A)
        expect(await store.getLinkedAddress('user-1')).toBe(ADDR_A)
      })

      it('returns null for a user with no linked address', async () => {
        expect(await store.getLinkedAddress('nobody')).toBeNull()
      })

      it('replaces the address when the same user links again (duplicate link)', async () => {
        await store.setLinkedAddress('user-1', ADDR_A)
        await store.setLinkedAddress('user-1', ADDR_B)

        expect(await store.getLinkedAddress('user-1')).toBe(ADDR_B)
      })

      it('is idempotent when the same address is linked twice', async () => {
        await store.setLinkedAddress('user-1', ADDR_A)
        await store.setLinkedAddress('user-1', ADDR_A)

        expect(await store.getLinkedAddress('user-1')).toBe(ADDR_A)
      })

      it('scopes addresses per user', async () => {
        await store.setLinkedAddress('user-1', ADDR_A)
        await store.setLinkedAddress('user-2', ADDR_B)

        expect(await store.getLinkedAddress('user-1')).toBe(ADDR_A)
        expect(await store.getLinkedAddress('user-2')).toBe(ADDR_B)
        expect(await store.getLinkedAddress('user-3')).toBeNull()
      })

      it('does not let one user overwrite another user\'s link', async () => {
        await store.setLinkedAddress('user-1', ADDR_A)
        await store.setLinkedAddress('user-2', ADDR_B)
        await store.setLinkedAddress('user-2', ADDR_A)

        expect(await store.getLinkedAddress('user-1')).toBe(ADDR_A)
      })
    })

    describe('clear (unlinking everything)', () => {
      it('removes every linked address', async () => {
        await store.setLinkedAddress('user-1', ADDR_A)
        await store.setLinkedAddress('user-2', ADDR_B)

        await store.clear()

        expect(await store.getLinkedAddress('user-1')).toBeNull()
        expect(await store.getLinkedAddress('user-2')).toBeNull()
      })

      it('is safe to call on an empty store', async () => {
        await expect(store.clear()).resolves.toBeUndefined()
      })

      it('allows relinking after a clear', async () => {
        await store.setLinkedAddress('user-1', ADDR_A)
        await store.clear()
        await store.setLinkedAddress('user-1', ADDR_B)

        expect(await store.getLinkedAddress('user-1')).toBe(ADDR_B)
      })
    })
  })
}

linkedAddressStoreContract('in-memory', () => new InMemoryLinkedAddressStore())

// Runs the same suite against a real database when one is configured (the table
// is created by the migrations); skipped otherwise.
linkedAddressStoreContract('postgres', () => new PostgresLinkedAddressStore(), Boolean(process.env.DATABASE_URL))

describe('InMemoryLinkedAddressStore specifics', () => {
  it('keeps separate instances isolated', async () => {
    const a = new InMemoryLinkedAddressStore()
    const b = new InMemoryLinkedAddressStore()
    await a.setLinkedAddress('user-1', ADDR_A)

    expect(await b.getLinkedAddress('user-1')).toBeNull()
  })

  it('stores the address exactly as given', async () => {
    const store = new InMemoryLinkedAddressStore()
    await store.setLinkedAddress('user-1', 'GMixedCaseAddress')

    expect(await store.getLinkedAddress('user-1')).toBe('GMixedCaseAddress')
  })
})

describe('PostgresLinkedAddressStore without a database', () => {
  it.skipIf(Boolean(process.env.DATABASE_URL))('rejects every operation when no pool is configured', async () => {
    const store = new PostgresLinkedAddressStore()

    await expect(store.setLinkedAddress('user-1', ADDR_A)).rejects.toThrow(/Database pool is not available/)
    await expect(store.getLinkedAddress('user-1')).rejects.toThrow(/Database pool is not available/)
    await expect(store.clear()).rejects.toThrow(/Database pool is not available/)
  })
})
