import { expect, test } from '@playwright/test';

const SEARCH = '/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020';
const LOT_URL = `${SEARCH}&lot=${encodeURIComponent('iaai:45973338')}`;
/** Recorded bidfax + stat.vin history (IAAI lot 46026832). */
const VIN = '4T1B11HK0KU821110';

test('vehicle history: lot-number search, VIN paste, merged timeline across sites', async ({ page }) => {
  // make sure the lot exists in the server DB (search stores lots)
  await page.goto(SEARCH);
  await expect(page.getByTestId('lot-row').first()).toBeVisible();
  await page.goto(LOT_URL);

  const sheet = page.getByRole('dialog');
  const section = sheet.getByTestId('history-section');
  await expect(section.getByTestId('history-vin')).toHaveText(/VIN is masked, so only lot #45973338 is searched/);

  // masked VIN → only bidfax by lot number, which has nothing for this lot
  await section.getByRole('button', { name: 'Check history' }).click();
  await expect(section.getByTestId('history-check')).toHaveText(['bidfax by lot number · 0 appearances found now']);
  await expect(section.getByText('No earlier auctions of this vehicle were found.')).toBeVisible();

  // paste the VIN from the photos: it doesn't fit the listing's masked VIN, which is flagged
  const vin = sheet.getByLabel('VIN from photos');
  await vin.fill(VIN.toLowerCase());
  await vin.press('Enter');
  await expect(sheet.getByTestId('vin-status')).toContainText("Doesn't match the VIN shown in the listing");
  await expect(section.getByTestId('history-vin')).toHaveText(`Searching by lot #45973338 and the pasted VIN ${VIN}`);
  await expect(section.getByTestId('history-check')).toHaveText([
    'bidfax by VIN · not checked yet',
    'stat.vin by VIN · not checked yet',
    'bidfax by lot number · 0 appearances found now',
  ]);

  await section.getByRole('button', { name: 'Refresh' }).click();
  await expect(section.getByTestId('history-check')).toHaveText([
    'bidfax by VIN · 1 appearance found now',
    'stat.vin by VIN · 2 appearances found now',
    'bidfax by lot number · 0 appearances found now',
  ]);

  const entries = section.getByTestId('history-entry');
  await expect(entries).toHaveCount(2);
  // newest first: the upcoming relist (stat.vin only), then the sale both sites recorded
  await expect(entries.nth(0)).toContainText('Sep 22, 2026');
  await expect(entries.nth(0)).toContainText('#46026832');
  await expect(entries.nth(0)).toContainText('Upcoming');
  await expect(entries.nth(0).getByTestId('history-price')).toHaveText('—');
  await expect(entries.nth(1)).toContainText('Sep 15, 2026');
  await expect(entries.nth(1)).toContainText('Not sold');
  await expect(entries.nth(1)).toContainText('Left Rear · 78,003 mi · Fontana (CA)');
  await expect(entries.nth(1).getByTestId('history-price')).toHaveText('$5,400');
  await expect(entries.nth(1).getByRole('link', { name: 'bidfax' })).toHaveAttribute(
    'href',
    /bidfax\.info\/toyota\/camry\/39201230-/,
  );
  await expect(entries.nth(1).getByRole('link', { name: 'stat.vin' })).toHaveAttribute('href', /stat\.vin\/cars\/4t1b11hk0ku821110-/);

  // stored: reopening shows the timeline without checking again
  await page.reload();
  await expect(page.getByRole('dialog').getByTestId('history-entry')).toHaveCount(2);
  await expect(page.getByRole('dialog').getByTestId('history-section').getByRole('button', { name: 'Refresh' })).toBeVisible();
});
