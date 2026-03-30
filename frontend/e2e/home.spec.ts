import { expect, test } from '@playwright/test'

test('about page loads core marketing content', async ({ page }) => {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: /making housing/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /our story/i })).toBeVisible()
})

test('about page visual regression stays stable', async ({ page }) => {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: /making housing/i })).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await expect(page).toHaveScreenshot('about-page.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    maxDiffPixelRatio: 0.001,
  })
})
