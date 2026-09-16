import { expect, test } from './test';

test('API is reachable through the dev proxy in mock mode', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ status: 'ok', sources: 'mock' });
});

test('app shell: navigation, dark default theme, light toggle, Bulgarian language', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Search lots' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.getByRole('link', { name: 'Tracking' }).click();
  await expect(page).toHaveURL(/\/tracking$/);
  await expect(page.getByRole('heading', { name: 'Tracking' })).toBeVisible();

  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);

  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: 'Български' }).click();
  await expect(page.getByRole('heading', { name: 'Следени' })).toBeVisible();

  // preferences survive a reload
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Следени' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});
