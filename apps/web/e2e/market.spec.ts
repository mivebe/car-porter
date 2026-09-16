import { expect, test } from '@playwright/test';

const SEARCH = '/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020';
const LOT_URL = `${SEARCH}&lot=${encodeURIComponent('iaai:45973338')}`;

// Lot: 2019 Toyota Camry SE, gasoline, 148 715 mi. Recorded Camry 2019 searches: mobile.bg 9 listings
// (5 still in the USA/Canada), cars.bg 3, AutoScout24 26 (EU), OLX none.
test('BG market: grouped listings, match toggles, exclusions and marketplace choice', async ({ page }) => {
  await page.goto(SEARCH);
  await expect(page.getByTestId('lot-row').first()).toBeVisible();
  await page.goto(LOT_URL);

  const sheet = page.getByRole('dialog');
  const section = sheet.getByTestId('market-section');
  await section.getByRole('button', { name: 'Check BG market' }).click();

  // default marketplaces: mobile.bg + cars.bg; import offers don't count
  await expect(section.getByTestId('market-count')).toHaveText('7 / 7');
  await expect(section.getByTestId('market-average')).toHaveText('€17,936');
  await expect(section.getByTestId('market-median')).toHaveText('€18,300');

  const mobile = section.getByTestId('market-group-mobileBg');
  await expect(mobile.getByTestId('market-site-status')).toContainText('9 listings found now · 5 ruled out by the criteria or located abroad');
  await expect(mobile.getByTestId('market-group-average')).toHaveText('€17,475 average of 4 listings');
  await expect(mobile.getByTestId('market-listing')).toHaveCount(4);
  await expect(mobile.getByTestId('market-listing-price').first()).toHaveText('€12,200');
  await expect(mobile.getByRole('link', { name: 'Open the search' })).toHaveAttribute(
    'href',
    'https://www.mobile.bg/obiavi/avtomobili-dzhipove/toyota/camry/ot-2019/do-2019',
  );
  await expect(section.getByTestId('market-group-carsBg').getByTestId('market-listing')).toHaveCount(3);
  await expect(section.getByTestId('market-group-autoscout24')).toHaveCount(0);

  // match the fuel too: hybrids drop out
  await section.getByLabel('Fuel').click();
  await expect(section.getByTestId('market-count')).toHaveText('3 / 3');
  await expect(section.getByTestId('market-average')).toHaveText('€20,517');

  // exclude the cheapest mobile.bg listing
  await mobile.getByTestId('market-listing').first().getByRole('checkbox').click();
  await expect(section.getByTestId('market-count')).toHaveText('2 / 3');
  await expect(section.getByTestId('market-average')).toHaveText('€21,625');

  // add AutoScout24 (EU reference): it hasn't been searched yet, so the button checks again
  await section.getByLabel('AutoScout24 (EU)').click();
  await expect(section.getByTestId('market-group-autoscout24').getByTestId('market-site-status')).toContainText('not checked yet');
  await section.getByRole('button', { name: 'Check BG market' }).click();
  const eu = section.getByTestId('market-group-autoscout24');
  await expect(eu).toContainText('AutoScout24 has no listings in Bulgaria');
  await expect(eu.getByTestId('market-listing')).toHaveCount(1);
  await expect(section.getByTestId('market-count')).toHaveText('3 / 4');
  await expect(section.getByTestId('market-average')).toHaveText('€23,413');
  await expect(section.getByRole('button', { name: 'Refresh' })).toBeVisible();

  // everything is stored: toggles, marketplaces, exclusions and listings
  await page.reload();
  const reopened = page.getByRole('dialog').getByTestId('market-section');
  await expect(reopened.getByTestId('market-count')).toHaveText('3 / 4');
  await expect(reopened.getByLabel('Fuel')).toBeChecked();
  await expect(reopened.getByLabel('AutoScout24 (EU)')).toBeChecked();
});
