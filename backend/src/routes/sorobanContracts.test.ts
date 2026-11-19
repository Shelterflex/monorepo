import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { loadContractAddresses } from '../config/contractAddresses.js'
import { createSorobanContractsRouter } from './sorobanContracts.js'

const VALID_CONTRACT_ID =
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'

describe('GET /soroban/contracts', () => {
  it('reports configured status and public network metadata without secrets', async () => {
    const app = express()
    app.use(
      '/soroban',
      createSorobanContractsRouter({
        networkPassphrase: 'Test SDF Network ; September 2015',
        rpcUrl: 'https://rpc.example.test',
        rpcLabel: 'testnet',
        addresses: loadContractAddresses({
          SOROBAN_DEAL_ESCROW_ID: VALID_CONTRACT_ID,
        }),
      }),
    )

    const response = await request(app).get('/soroban/contracts').expect(200)

    expect(response.body.network).toEqual({
      passphrase: 'Test SDF Network ; September 2015',
      rpcLabel: 'testnet',
    })
    expect(response.body.contracts.dealEscrow).toEqual({
      envVar: 'SOROBAN_DEAL_ESCROW_ID',
      configured: true,
      address: VALID_CONTRACT_ID,
    })
    expect(response.body.contracts.rentPayments.configured).toBe(false)
    expect(response.body.contracts.rentPayments.address).toBeNull()
    expect(JSON.stringify(response.body)).not.toContain('secret')
  })
})
