import { expect, test } from './test';

// Mock sources simulate these failures through the real parsers (apps/server/src/sources/mock-fetchers.ts).

test('search: every source failing shows typed badges and an error state', async ({ page }) => {
  await page.goto('/?make=Toyota&model=Corolla&yearFrom=2018&yearTo=2020');

  await expect(page.getByRole('alert')).toContainText('Could not search any source');
  await expect(page.getByText('No lots match these filters.')).toBeHidden();
  await expect(page.getByTestId('source-status-Copart')).toHaveText('Copart: blocked');
  await expect(page.getByTestId('source-status-IAAI')).toHaveText('IAAI: parsing failed');

  await page.getByTestId('source-status-Copart').hover();
  await expect(page.getByRole('tooltip')).toContainText('copart: blocked by cloudflare');
});

test('lot sheet: a blocked estimate and a broken marketplace fail per section, not the whole view', async ({
  page,
}) => {
  const search = '/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020';
  await page.goto(search);
  await expect(page.getByTestId('lot-row').first()).toBeVisible();
  await page.goto(`${search}&lot=${encodeURIComponent('iaai:45874574')}`); // 2018 Camry SE

  const sheet = page.getByRole('dialog');
  const estimate = sheet.getByTestId('estimate-section');
  await estimate.getByRole('button', { name: 'Estimate price' }).click();
  await expect(estimate.getByTestId('estimate-error')).toHaveText(
    'blocked: bidfax: 429 rate-limit page',
  );
  await expect(sheet.getByTestId('bid-source')).toHaveText('No price yet.');

  const market = sheet.getByTestId('market-section');
  await market.getByRole('button', { name: 'Check BG market' }).click();
  await expect(
    market.getByTestId('market-group-mobileBg').getByTestId('market-site-status'),
  ).toHaveText('parsing failed: mobileBg: search markup not recognized');
  await expect(
    market.getByTestId('market-group-carsBg').getByTestId('market-site-status'),
  ).toContainText('0 listings found now');

  // the rest of the sheet keeps working
  const verdict = sheet.getByTestId('verdict-section');
  await expect(verdict.getByTestId('verdict-status')).toHaveText('Not enough data');
  await sheet.getByLabel('Purchase price (bid)').fill('4000');
  await sheet.getByLabel('Purchase price (bid)').press('Enter');
  await expect(sheet.getByTestId('cost-total')).toBeVisible();
  await expect(verdict.getByTestId('verdict-missing').getByRole('listitem')).toHaveText([
    /No BG market price/,
  ]);
});
