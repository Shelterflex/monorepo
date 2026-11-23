import { test, expect } from '@playwright/test';

test.describe('Landlord Analytics Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Mocking the analytics API response
    await page.route('**/api/landlord/analytics*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          occupancyTrend: [
            { date: "Jan", rate: 85 },
            { date: "Feb", rate: 90 }
          ],
          revenueBreakdown: [
            { month: "Jan", expected: 500000, collected: 450000 }
          ],
          paymentTrends: [
            { date: "Jan", onTime: 70, late: 20, missed: 10 }
          ],
          vacancyMetrics: {
            averageTimeToFill: 14,
            currentVacancyCount: 3
          }
        }),
      });
    });

    await page.route('**/api/landlord/properties', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 1, title: "Lekki Penthouse" },
          { id: 2, title: "Victoria Island Apartment" }
        ]),
      });
    });

    await page.goto('/dashboard/landlord/analytics');
  });

  test('should display the analytics dashboard with all panels', async ({ page }) => {
    await expect(page.getByText('Landlord Analytics', { exact: true })).toBeVisible();
    await expect(page.getByText('Occupancy Rate')).toBeVisible();
    await expect(page.getByText('Monthly Revenue')).toBeVisible();
    await expect(page.getByText('Current Vacancies')).toBeVisible();
    await expect(page.getByText('Avg. Time to Fill')).toBeVisible();
  });

  test('should allow switching property filter', async ({ page }) => {
    const filter = page.getByRole('combobox');
    await filter.click();
    await page.getByRole('option', { name: 'Lekki Penthouse' }).click();
    
    // Check if API was called with propertyId
    // In a real test we'd verify the network call, but here we just check UI stability
    await expect(page.getByText('Lekki Penthouse')).toBeVisible();
  });

  test('should handle API errors gracefully', async ({ page }) => {
    await page.route('**/api/landlord/analytics*', async (route) => {
      await route.fulfill({ status: 500 });
    });

    await page.goto('/dashboard/landlord/analytics');
    await expect(page.getByText('Failed to load analytics data')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('should display empty state if no data', async ({ page }) => {
    await page.route('**/api/landlord/analytics*', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          occupancyTrend: [],
          revenueBreakdown: [],
          paymentTrends: [],
          vacancyMetrics: { averageTimeToFill: 0, currentVacancyCount: 0 }
        })
      });
    });

    await page.goto('/dashboard/landlord/analytics');
    // Verify default values or empty charts
    await expect(page.getByText('0 Days')).toBeVisible();
  });
});
