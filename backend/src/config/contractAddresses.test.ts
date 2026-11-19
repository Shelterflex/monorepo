import { describe, expect, it } from 'vitest'
import { StrKey } from '@stellar/stellar-sdk'
import {
  CONTRACT_ENV_VARS,
  loadContractAddresses,
} from './contractAddresses.js'

const VALID_CONTRACT_ID =
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'

describe('contract address config', () => {
  it('loads valid addresses into a typed object and records unset entries', () => {
    expect(StrKey.isValidContract(VALID_CONTRACT_ID)).toBe(true)
    const addresses = loadContractAddresses({
      SOROBAN_DEAL_ESCROW_ID: VALID_CONTRACT_ID,
    })

    expect(addresses.dealEscrow).toBe(VALID_CONTRACT_ID)
    expect(addresses.rentPayments).toBeUndefined()
    expect(Object.keys(addresses)).toEqual(Object.keys(CONTRACT_ENV_VARS))
  })

  it('recognizes MULTISIG_ADMIN_ID (issue #1972)', () => {
    expect(CONTRACT_ENV_VARS.multisigAdmin).toBe('MULTISIG_ADMIN_ID')

    const addresses = loadContractAddresses({ MULTISIG_ADMIN_ID: VALID_CONTRACT_ID })
    expect(addresses.multisigAdmin).toBe(VALID_CONTRACT_ID)
    expect(loadContractAddresses({}).multisigAdmin).toBeUndefined()
    expect(() => loadContractAddresses({ MULTISIG_ADMIN_ID: 'nope' })).toThrow(
      'Invalid Soroban contract ID in MULTISIG_ADMIN_ID',
    )
  })

  it('recognizes SOROBAN_MVP_STAKING_POOL_ID (issue #1493)', () => {
    expect(CONTRACT_ENV_VARS.mvpStakingPool).toBe('SOROBAN_MVP_STAKING_POOL_ID')

    const addresses = loadContractAddresses({
      SOROBAN_MVP_STAKING_POOL_ID: VALID_CONTRACT_ID,
    })
    expect(addresses.mvpStakingPool).toBe(VALID_CONTRACT_ID)
  })



  it('fails fast with the offending environment variable', () => {
    expect(() =>
      loadContractAddresses({
        SOROBAN_DEAL_ESCROW_ID: 'not-a-contract',
      }),
    ).toThrow(
      'Invalid Soroban contract ID in SOROBAN_DEAL_ESCROW_ID',
    )
  })
})

