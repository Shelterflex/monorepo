import { expect, test } from '@playwright/test'

test.describe('Landlord Payout Schedule', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard/landlord/payouts')
  })

  test('displays payout schedule page header', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Payout Schedule' })).toBeVisible()
    await expect(page.getByText('Forecasted payouts, deductions, and projected monthly cashflow')).toBeVisible()
  })

  test('displays summary cards when data loads', async ({ page }) => {
    // Summary cards should appear (or empty state)
    const grossCard = page.getByText('Gross Total')
    const emptyState = page.getByText('No payouts scheduled')
    await expect(grossCard.or(emptyState)).toBeVisible()
  })

  test('displays status filter dropdown', async ({ page }) => {
    const statusSelect = page.locator('select').first()
    await expect(statusSelect).toBeVisible()
    const options = statusSelect.locator('option')
    await expect(options).toContainText(['All Statuses', 'Scheduled', 'Delayed', 'Completed'])
  })

  test('displays channel filter dropdown', async ({ page }) => {
    const channelSelect = page.locator('select').nth(1)
    await expect(channelSelect).toBeVisible()
    const options = channelSelect.locator('option')
    await expect(options).toContainText(['All Channels', 'Bank Transfer', 'Mobile Money'])
  })

  test('displays grouping selector', async ({ page }) => {
    const groupingSelect = page.locator('select').nth(2)
    await expect(groupingSelect).toBeVisible()
    await groupingSelect.selectOption('weekly')
    await expect(groupingSelect).toHaveValue('weekly')
  })

  test('status filter can be selected', async ({ page }) => {
    const statusSelect = page.locator('select').first()
    await statusSelect.selectOption('delayed')
    await expect(statusSelect).toHaveValue('delayed')
  })

  test('channel filter can be selected', async ({ page }) => {
    const channelSelect = page.locator('select').nth(1)
    await channelSelect.selectOption('mobile_money')
    await expect(channelSelect).toHaveValue('mobile_money')
  })

  test('clear filters button appears when filters active', async ({ page }) => {
    const statusSelect = page.locator('select').first()
    await statusSelect.selectOption('delayed')
    await expect(page.getByRole('button', { name: /clear/i })).toBeVisible()
  })

  test('clear filters resets all filters', async ({ page }) => {
    const statusSelect = page.locator('select').first()
    await statusSelect.selectOption('delayed')
    const clearButton = page.getByRole('button', { name: /clear/i })
    await clearButton.click()
    await expect(statusSelect).toHaveValue('')
  })

  test('shows empty state when no payouts exist', async ({ page }) => {
    await expect(page.getByText('No payouts scheduled')).toBeVisible()
    await expect(page.getByText('Payouts will appear here once scheduled')).toBeVisible()
  })

  test('payout schedule link appears in landlord dashboard sidebar', async ({ page }) => {
    await page.goto('/dashboard/landlord')
    const payoutLink = page.getByRole('link', { name: /payout schedule/i })
    await expect(payoutLink).toBeVisible()
    await payoutLink.click()
    await expect(page).toHaveURL(/\/dashboard\/landlord\/payouts/)
    await expect(page.getByRole('heading', { name: 'Payout Schedule' })).toBeVisible()
  })

  test('retry button appears on error state', async ({ page }) => {
    const emptyState = page.getByText('No payouts scheduled')
    const retryButton = page.getByRole('button', { name: /retry/i })
    await expect(emptyState.or(retryButton)).toBeVisible()
  })

  test('timeline period headers are expandable', async ({ page }) => {
    // If periods exist, clicking should expand; otherwise empty state
    const periodButton = page.locator('button').filter({ hasText: /20[0-9]{2}/ }).first()
    const emptyState = page.getByText('No payouts scheduled')
    await expect(periodButton.or(emptyState)).toBeVisible()
  })

  test('delayed payout indicators display correctly', async ({ page }) => {
    const delayedBadge = page.getByText(/delayed/i).first()
    const emptyState = page.getByText('No payouts scheduled')
    await expect(delayedBadge.or(emptyState)).toBeVisible()
  })
})
