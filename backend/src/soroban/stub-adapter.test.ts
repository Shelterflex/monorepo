import { describe, test, expect, beforeEach } from 'vitest'
import { StubSorobanAdapter } from './stub-adapter.js'
import { TestSorobanAdapter } from './test-adapter.js'
import { SorobanConfig } from './client.js'

describe('StubSorobanAdapter', () => {
    const baseConfig: SorobanConfig = {
        rpcUrl: 'http://localhost:8000',
        networkPassphrase: 'Test SDF Network ; September 2015',
    }

    beforeEach(() => {
        StubSorobanAdapter._testOnlyReset()
    })

    test('deterministic behavior with same seed', async () => {
        const config1 = { ...baseConfig, seed: 'test-seed' }
        const adapter1 = new StubSorobanAdapter(config1)
        const balance1 = await adapter1.getBalance('GABC')

        const config2 = { ...baseConfig, seed: 'test-seed' }
        const adapter2 = new StubSorobanAdapter(config2)
        const balance2 = await adapter2.getBalance('GABC')

        expect(balance1).toBe(balance2)
    })

    test('different behavior with different seeds', async () => {
        const config1 = { ...baseConfig, seed: 'deterministic-seed-1' }
        const adapter1 = new StubSorobanAdapter(config1)
        const balance1 = await adapter1.getBalance('GABC')

        StubSorobanAdapter._testOnlyReset()

        const config2 = { ...baseConfig, seed: 'deterministic-seed-2' }
        const adapter2 = new StubSorobanAdapter(config2)
        const balance2 = await adapter2.getBalance('GABC')

        expect(balance1).not.toBe(balance2)
    })

    test('reset clears balances', async () => {
        const adapter = new StubSorobanAdapter(baseConfig)
        await adapter.credit('GABC', 5000n)
        const balanceBefore = await adapter.getBalance('GABC')

        StubSorobanAdapter._testOnlyReset()
        
        const adapterNew = new StubSorobanAdapter(baseConfig)
        const balanceAfter = await adapterNew.getBalance('GABC')
        
        expect(balanceBefore).toBeGreaterThan(balanceAfter) // Credit was lost
    })

    test('instance reset clears ledger', async () => {
        const adapter = new StubSorobanAdapter(baseConfig)
        await adapter.getReceiptEvents(1000)
        // Internal _ledger is now 1001
        
        adapter._testOnlyReset()
        
        const events = await adapter.getReceiptEvents(null)
        expect(events[0].ledger).toBe(1001) // Starts from 1000 + 1
    })
})

describe('TestSorobanAdapter', () => {
    const baseConfig: SorobanConfig = {
        rpcUrl: 'http://localhost:8000',
        networkPassphrase: 'Test SDF Network ; September 2015',
    }

    test('reset clears parent stub state', async () => {
        const adapter = new TestSorobanAdapter(baseConfig)
        await adapter.credit('GABC', 5000n)
        
        adapter.reset()
        
        const balance = await adapter.getBalance('GABC')
        expect(balance).toBeLessThan(5000n) // Should be the initial hash-based balance
    })
})
