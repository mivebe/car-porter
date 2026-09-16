import type { Page } from '@playwright/test';
import { expect, test } from './test';

async function pick(page: Page, label: string, search: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByPlaceholder(/Search (manufacturers|models)/).fill(search);
  await page.getByRole('option', { name: option, exact: true }).click();
}

// One pass through the whole app with the UI only. Scans are shared per model/year, so a section's
// button may already read "Refresh" when other specs ran first.
test('happy path: search → lot → estimate → history → cost → market → verdict → track → settings → language', async ({
  page,
}) => {
  await page.goto('/');
  await pick(page, 'Manufacturer', 'toyo', 'Toyota');
  await pick(page, 'Model', 'cam', 'Camry');
  await page.getByLabel('Year from').fill('2018');
  await page.getByLabel('Year to').fill('2020');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await page.getByRole('tab', { name: 'IAAI' }).click();
  await page.getByTestId('lot-row').filter({ hasText: '#45810260' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: '2019 Toyota Camry LE' })).toBeVisible();

  // estimate → becomes the purchase price
  const estimate = sheet.getByTestId('estimate-section');
  await estimate.getByRole('button', { name: /Estimate price|Refresh/ }).click();
  await expect(estimate.getByTestId('estimate-average')).toBeVisible();
  await expect(sheet.getByTestId('bid-source')).toHaveText('Average of past bidfax sales.');

  // history with a VIN pasted from the photos
  await sheet.getByLabel('VIN from photos').fill('4T1B11HK0KU821110');
  await sheet.getByLabel('VIN from photos').press('Enter');
  const history = sheet.getByTestId('history-section');
  await history.getByRole('button', { name: /Check history|Refresh/ }).click();
  await expect(history.getByTestId('history-entry')).toHaveCount(2);

  // cost toggles
  const total = sheet.getByTestId('cost-total');
  const fullTotal = await total.textContent();
  await sheet.getByLabel('Reduced fees (÷3)').click();
  await expect(total).not.toHaveText(fullTotal!);

  // BG market with a match toggle
  const market = sheet.getByTestId('market-section');
  await market.getByRole('button', { name: /Check BG market|Refresh/ }).click();
  await expect(market.getByTestId('market-average')).toBeVisible();
  await market.getByLabel('Transmission').click();
  await expect(market.getByLabel('Transmission')).toBeChecked();

  // verdict, then track
  const verdict = sheet.getByTestId('verdict-section');
  await expect(verdict.getByTestId('verdict-status')).toHaveText('Worth it');
  const margin = await verdict.getByTestId('verdict-margin').textContent();
  await sheet.getByRole('button', { name: 'Track', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Tracked', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await page.getByRole('link', { name: 'Tracking' }).click();
  const row = page.getByTestId('tracked-row').filter({ hasText: '#45810260' });
  await expect(row.getByTestId('tracked-margin')).toHaveText(margin!);
  await expect(row.getByTestId('verdict-status')).toHaveText('Worth it');

  // a stricter threshold in settings changes the verdict everywhere
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('“Worth it” from a margin of').fill('50000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.getByRole('link', { name: 'Tracking' }).click();
  await expect(row.getByTestId('verdict-status')).toHaveText('Borderline');

  // language and theme from the header
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: 'Български' }).click();
  await expect(page.getByRole('heading', { name: 'Следени' })).toBeVisible();
  await expect(row.getByTestId('verdict-status')).toHaveText('На ръба');
});
