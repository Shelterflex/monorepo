import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CurrencyToggle } from '../currency-toggle'

const currencyState = {
  displayCurrency: 'NGN' as 'NGN' | 'USDC',
  isHydrated: true,
  setDisplayCurrency: vi.fn(),
}

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => currencyState,
}))

beforeEach(() => {
  currencyState.displayCurrency = 'NGN'
  currencyState.isHydrated = true
  currencyState.setDisplayCurrency = vi.fn()
})

describe('CurrencyToggle', () => {
  it('exposes a labelled group with both currency options', () => {
    render(<CurrencyToggle />)

    expect(screen.getByRole('group', { name: 'Display currency' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'NGN' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'USDC' })).toBeInTheDocument()
  })

  it('marks the persisted currency as pressed', () => {
    currencyState.displayCurrency = 'USDC'
    render(<CurrencyToggle />)

    expect(screen.getByRole('button', { name: 'USDC' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'NGN' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('saves the chosen currency when a different option is clicked', async () => {
    const user = userEvent.setup()
    render(<CurrencyToggle />)

    await user.click(screen.getByRole('button', { name: 'USDC' }))

    expect(currencyState.setDisplayCurrency).toHaveBeenCalledWith('USDC')
  })

  it('disables both options until preferences are hydrated', () => {
    currencyState.isHydrated = false
    render(<CurrencyToggle />)

    expect(screen.getByRole('button', { name: 'NGN' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'USDC' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'NGN' })).toHaveAttribute('aria-pressed', 'false')
  })
})
