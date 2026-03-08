import { describe, it, expect, beforeEach } from 'vitest'
import { NgnWalletService, computeEffect } from './ngnWalletService.js'
import { LedgerEntryType } from '../models/ngnWallet.js'

describe('computeEffect', () => {
  it('TOPUP_PENDING: adds to held only', () => {
    expect(computeEffect(LedgerEntryType.TOPUP_PENDING, 1000)).toEqual({ availableDelta: 0, heldDelta: 1000 })
  })

  it('TOPUP_CONFIRMED: adds to available only', () => {
    expect(computeEffect(LedgerEntryType.TOPUP_CONFIRMED, 1000)).toEqual({ availableDelta: 1000, heldDelta: 0 })
  })

  it('TOPUP_REVERSED: subtracts from available only', () => {
    expect(computeEffect(LedgerEntryType.TOPUP_REVERSED, 500)).toEqual({ availableDelta: -500, heldDelta: 0 })
  })

  it('STAKE_RESERVE: subtracts from available, adds to held', () => {
    expect(computeEffect(LedgerEntryType.STAKE_RESERVE, 2000)).toEqual({ availableDelta: -2000, heldDelta: 2000 })
  })

  it('STAKE_RELEASE: adds to available, subtracts from held', () => {
    expect(computeEffect(LedgerEntryType.STAKE_RELEASE, 2000)).toEqual({ availableDelta: 2000, heldDelta: -2000 })
  })

  it('CONVERSION_DEBIT: subtracts from held only', () => {
    expect(computeEffect(LedgerEntryType.CONVERSION_DEBIT, 1500)).toEqual({ availableDelta: 0, heldDelta: -1500 })
  })

  it('WITHDRAWAL_PENDING: subtracts from available, adds to held', () => {
    expect(computeEffect(LedgerEntryType.WITHDRAWAL_PENDING, 3000)).toEqual({ availableDelta: -3000, heldDelta: 3000 })
  })

  it('WITHDRAWAL_CONFIRMED: subtracts from held only', () => {
    expect(computeEffect(LedgerEntryType.WITHDRAWAL_CONFIRMED, 3000)).toEqual({ availableDelta: 0, heldDelta: -3000 })
  })

  it('WITHDRAWAL_FAILED: adds to available, subtracts from held', () => {
    expect(computeEffect(LedgerEntryType.WITHDRAWAL_FAILED, 3000)).toEqual({ availableDelta: 3000, heldDelta: -3000 })
  })

  it('ADJUSTMENT: signed amount affects available only', () => {
    expect(computeEffect(LedgerEntryType.ADJUSTMENT, 500)).toEqual({ availableDelta: 500, heldDelta: 0 })
    expect(computeEffect(LedgerEntryType.ADJUSTMENT, -200)).toEqual({ availableDelta: -200, heldDelta: 0 })
  })
})

describe('NgnWalletService – getWalletBalance', () => {
  let service: NgnWalletService
  const userId = 'user-abc'

  beforeEach(() => {
    service = new NgnWalletService()
  })

  it('starts with zero balance', () => {
    const balance = service.getWalletBalance(userId)
    expect(balance).toEqual({ availableBalanceNgn: 0, heldBalanceNgn: 0, totalBalanceNgn: 0 })
  })

  it('TOPUP_CONFIRMED increases availableBalanceNgn', async () => {
    await service.addEntry(userId, LedgerEntryType.TOPUP_CONFIRMED, 10000)
    const balance = service.getWalletBalance(userId)
    expect(balance.availableBalanceNgn).toBe(10000)
    expect(balance.heldBalanceNgn).toBe(0)
    expect(balance.totalBalanceNgn).toBe(10000)
  })

  it('STAKE_RESERVE reduces available and increases held', async () => {
    await service.addEntry(userId, LedgerEntryType.TOPUP_CONFIRMED, 10000)
    await service.addEntry(userId, LedgerEntryType.STAKE_RESERVE, 3000)
    const balance = service.getWalletBalance(userId)
    expect(balance.availableBalanceNgn).toBe(7000)
    expect(balance.heldBalanceNgn).toBe(3000)
    expect(balance.totalBalanceNgn).toBe(10000)
  })

  it('CONVERSION_DEBIT reduces held', async () => {
    await service.addEntry(userId, LedgerEntryType.TOPUP_CONFIRMED, 10000)
    await service.addEntry(userId, LedgerEntryType.STAKE_RESERVE, 3000)
    await service.addEntry(userId, LedgerEntryType.CONVERSION_DEBIT, 3000)
    const balance = service.getWalletBalance(userId)
    expect(balance.availableBalanceNgn).toBe(7000)
    expect(balance.heldBalanceNgn).toBe(0)
    expect(balance.totalBalanceNgn).toBe(7000)
  })

  it('totalBalanceNgn always equals available + held', async () => {
    await service.addEntry(userId, LedgerEntryType.TOPUP_CONFIRMED, 50000)
    await service.addEntry(userId, LedgerEntryType.WITHDRAWAL_PENDING, 5000)
    const balance = service.getWalletBalance(userId)
    expect(balance.totalBalanceNgn).toBe(balance.availableBalanceNgn + balance.heldBalanceNgn)
  })
})

describe('NgnWalletService – initiateWithdrawal', () => {
  let service: NgnWalletService
  const userId = 'user-abc'

  beforeEach(async () => {
    service = new NgnWalletService()
    await service.addEntry(userId, LedgerEntryType.TOPUP_CONFIRMED, 50000)
  })

  it('creates a WITHDRAWAL_PENDING entry and reduces available', async () => {
    await service.initiateWithdrawal(userId, {
      amountNgn: 10000,
      bankAccount: { accountNumber: '1234567890', accountName: 'Test User', bankName: 'Test Bank' },
    })
    const balance = service.getWalletBalance(userId)
    expect(balance.availableBalanceNgn).toBe(40000)
    expect(balance.heldBalanceNgn).toBe(10000)
  })

  it('throws VALIDATION_ERROR when requested amount exceeds available', async () => {
    await expect(
      service.initiateWithdrawal(userId, {
        amountNgn: 100000,
        bankAccount: { accountNumber: '1234567890', accountName: 'Test User', bankName: 'Test Bank' },
      }),
    ).rejects.toThrow('Insufficient balance')
  })
})

describe('NgnWalletService – processWithdrawal', () => {
  let service: NgnWalletService
  const userId = 'user-abc'

  beforeEach(async () => {
    service = new NgnWalletService()
    await service.addEntry(userId, LedgerEntryType.TOPUP_CONFIRMED, 50000)
  })

  it('WITHDRAWAL_CONFIRMED removes amount from held', async () => {
    const { id } = await service.initiateWithdrawal(userId, {
      amountNgn: 10000,
      bankAccount: { accountNumber: '1234567890', accountName: 'Test User', bankName: 'Test Bank' },
    })
    await service.processWithdrawal(id, 'confirmed')
    const balance = service.getWalletBalance(userId)
    expect(balance.heldBalanceNgn).toBe(0)
    expect(balance.availableBalanceNgn).toBe(40000)
    expect(balance.totalBalanceNgn).toBe(40000)
  })

  it('WITHDRAWAL_FAILED restores amount to available', async () => {
    const { id } = await service.initiateWithdrawal(userId, {
      amountNgn: 10000,
      bankAccount: { accountNumber: '1234567890', accountName: 'Test User', bankName: 'Test Bank' },
    })
    await service.processWithdrawal(id, 'failed')
    const balance = service.getWalletBalance(userId)
    expect(balance.heldBalanceNgn).toBe(0)
    expect(balance.availableBalanceNgn).toBe(50000)
  })
})
