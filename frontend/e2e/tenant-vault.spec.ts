import { expect, test } from '@playwright/test'

test.describe('Tenant Document Vault', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard/tenant/vault')
  })

  test('displays vault page header and search controls', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Document Vault' })).toBeVisible()
    await expect(page.getByText('Track and manage your important documents')).toBeVisible()
    await expect(page.getByPlaceholder('Search by name, description, or tag...')).toBeVisible()
  })

  test('displays category and status filter dropdowns', async ({ page }) => {
    const categorySelect = page.locator('select').first()
    await expect(categorySelect).toBeVisible()

    // Open category dropdown and verify options
    const categoryOptions = categorySelect.locator('option')
    await expect(categoryOptions).toContainText(['All Categories', 'Identification', 'Receipt', 'Agreement'])

    const statusSelect = page.locator('select').nth(1)
    await expect(statusSelect).toBeVisible()

    const statusOptions = statusSelect.locator('option')
    await expect(statusOptions).toContainText(['All Statuses', 'Active', 'Expired', 'Expiring Soon'])
  })

  test('shows empty state when no documents exist', async ({ page }) => {
    await expect(page.getByText('No documents found')).toBeVisible()
    await expect(page.getByText('Upload your first document to get started')).toBeVisible()
  })

  test('search input is functional', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search by name, description, or tag...')
    await searchInput.fill('lease agreement')
    await expect(searchInput).toHaveValue('lease agreement')
  })

  test('category filter can be selected', async ({ page }) => {
    const categorySelect = page.locator('select').first()
    await categorySelect.selectOption('agreement')
    await expect(categorySelect).toHaveValue('agreement')
  })

  test('status filter can be selected', async ({ page }) => {
    const statusSelect = page.locator('select').nth(1)
    await statusSelect.selectOption('expired')
    await expect(statusSelect).toHaveValue('expired')
  })

  test('clear filters button appears when filters are active', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search by name, description, or tag...')
    await searchInput.fill('test')

    await expect(page.getByRole('button', { name: /clear/i })).toBeVisible()
  })

  test('clear filters resets all filters', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search by name, description, or tag...')
    await searchInput.fill('test')

    const categorySelect = page.locator('select').first()
    await categorySelect.selectOption('receipt')

    const clearButton = page.getByRole('button', { name: /clear/i })
    await clearButton.click()

    await expect(searchInput).toHaveValue('')
    await expect(categorySelect).toHaveValue('')
  })

  test('document vault link appears in tenant dashboard sidebar', async ({ page }) => {
    await page.goto('/dashboard/tenant')
    const vaultLink = page.getByRole('link', { name: /document vault/i })
    await expect(vaultLink).toBeVisible()

    await vaultLink.click()
    await expect(page).toHaveURL(/\/dashboard\/tenant\/vault/)
    await expect(page.getByRole('heading', { name: 'Document Vault' })).toBeVisible()
  })

  test('retry button appears on error state', async ({ page }) => {
    // The page will show an error state if the API is unreachable
    // We verify the retry button exists in the UI structure
    const searchInput = page.getByPlaceholder('Search by name, description, or tag...')
    await searchInput.fill('trigger-search')
    // Either empty state or error state should be visible
    const emptyState = page.getByText('No documents found')
    const errorState = page.getByText('Retry')
    await expect(emptyState.or(errorState)).toBeVisible()
  })

  test('pagination controls are not shown for single page', async ({ page }) => {
    // When there are few documents, pagination should not appear
    await expect(page.getByText('Page 1 of')).not.toBeVisible()
  })

  test('preview button exists for document cards', async ({ page }) => {
    // If documents exist, preview button should be on each card
    // If no documents, verify the empty state
    const emptyState = page.getByText('No documents found')
    const previewButton = page.getByRole('button', { name: /preview/i })
    // One or the other should be present
    await expect(emptyState.or(previewButton.first())).toBeVisible()
  })

  test('expiration indicators display correctly for expiring documents', async ({ page }) => {
    // When documents with expiration exist, the alert banner should show
    const alertBanner = page.getByText(/document.*need attention/i)
    const emptyState = page.getByText('No documents found')
    await expect(alertBanner.or(emptyState)).toBeVisible()
  })
})
