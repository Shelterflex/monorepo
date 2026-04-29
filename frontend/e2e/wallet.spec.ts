import { expect, test } from '@playwright/test'

test.describe('Wallet Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/wallet')
  })

  test('displays multi-currency balance cards', async ({ page }) => {
    // Check for NGN balance card
    await expect(page.getByText('Nigerian Naira')).toBeVisible()
    await expect(page.getByText('₦')).toBeVisible()

    // Check for USDC balance card
    await expect(page.getByText('USD Coin')).toBeVisible()
    await expect(page.getByText('$')).toBeVisible()

    // Check for Rewards balance card
    await expect(page.getByText('Rewards')).toBeVisible()
    await expect(page.getByText('★')).toBeVisible()
  })

  test('displays conversion preview section', async ({ page }) => {
    // Check for conversion section
    await expect(page.getByText('Convert NGN')).toBeVisible()
    await expect(page.getByText('Convert NGN to USDC')).toBeVisible()

    // Check for amount input
    const amountInput = page.getByPlaceholder('0.00')
    await expect(amountInput).toBeVisible()
  })

  test('shows conversion quote when amount is entered', async ({ page }) => {
    const amountInput = page.getByPlaceholder('0.00')
    await amountInput.fill('1000')

    // Wait for quote to load (debounced)
    await page.waitForTimeout(600)

    // Check for quote display
    await expect(page.getByText('You will receive')).toBeVisible()
    await expect(page.getByText('Rate')).toBeVisible()
    await expect(page.getByText('Fees')).toBeVisible()
  })

  test('displays currency filter options', async ({ page }) => {
    // Check for currency filter section
    await expect(page.getByText('Currency:')).toBeVisible()

    // Check for individual currency filter buttons
    await expect(page.getByText('₦ Nigerian Naira')).toBeVisible()
    await expect(page.getByText('$ USD Coin')).toBeVisible()
    await expect(page.getByText('★ Rewards')).toBeVisible()
  })

  test('allows filtering by currency', async ({ page }) => {
    // Click on NGN currency filter
    const ngnFilter = page.getByText('₦ Nigerian Naira')
    await ngnFilter.click()

    // Check that filter is active (has ring or highlighted state)
    const ngnCard = page.getByText('Nigerian Naira').locator('..').locator('..')
    await expect(ngnCard).toHaveClass(/ring-2/)

    // Clear filter
    const clearButton = page.getByRole('button').filter({ hasText: 'Clear' }).first()
    await clearButton.click()
  })

  test('displays transaction type filters', async ({ page }) => {
    // Check for type filter section
    await expect(page.getByText('Type:')).toBeVisible()

    // Check for individual type filter buttons
    await expect(page.getByText('Top-ups')).toBeVisible()
    await expect(page.getByText('Withdrawals')).toBeVisible()
    await expect(page.getByText('Staking')).toBeVisible()
    await expect(page.getByText('Reversals')).toBeVisible()
    await expect(page.getByText('Rewards')).toBeVisible()
  })

  test('allows filtering by transaction type', async ({ page }) => {
    // Click on Top-ups filter
    const topupsFilter = page.getByText('Top-ups')
    await topupsFilter.click()

    // Check that filter is active
    await expect(topupsFilter).toHaveClass(/data-state=on/)

    // Clear filter
    const clearButton = page.getByRole('button').filter({ hasText: 'Clear' }).first()
    await clearButton.click()
  })

  test('currency selection highlights balance card', async ({ page }) => {
    // Click on USDC balance card refresh button
    const usdcRefresh = page.getByText('USD Coin').locator('..').getByRole('button')
    await usdcRefresh.click()

    // Check that USDC card is highlighted
    const usdcCard = page.getByText('USD Coin').locator('..').locator('..')
    await expect(usdcCard).toHaveClass(/ring-2/)
  })

  test('conversion preview shows error on invalid amount', async ({ page }) => {
    const amountInput = page.getByPlaceholder('0.00')
    await amountInput.fill('-100')

    // Wait for quote to load
    await page.waitForTimeout(600)

    // Check for error state (quote should not show for negative amounts)
    await expect(page.getByText('You will receive')).not.toBeVisible()
  })

  test('displays activity section with filters', async ({ page }) => {
    // Check for activity section
    await expect(page.getByText('Activity')).toBeVisible()

    // Check for filter toggle on mobile
    const filterButton = page.getByRole('button').filter({ hasText: 'Filters' })
    await expect(filterButton).toBeVisible()
  })

  test('refresh button reloads wallet data', async ({ page }) => {
    const refreshButton = page.getByRole('button').filter({ has: page.locator('svg').filter({ hasText: /refresh/i }) })

    // Click refresh
    await refreshButton.click()

    // Check that data reloads (skeletons may appear briefly)
    await expect(page.getByText('Nigerian Naira')).toBeVisible()
  })
})
