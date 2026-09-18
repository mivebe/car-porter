import { expect, test } from './test';

const LOT_URL = `/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020&lot=${encodeURIComponent('iaai:45973338')}`;

test('bidfax estimate: matches, include/exclude, feeds the cost calculation', async ({ page }) => {
  // make sure the lot exists in the server DB (search stores lots)
  await page.goto('/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020');
  await expect(page.getByTestId('lot-row').first()).toBeVisible();
  await page.goto(LOT_URL);

  const sheet = page.getByRole('dialog');
  const section = sheet.getByTestId('estimate-section');
  await expect(sheet.getByTestId('bid-source')).toHaveText('No price yet.');

  await section.getByRole('button', { name: 'Estimate price' }).click();

  // the list of sales starts collapsed
  const matches = section.getByTestId('estimate-match');
  const toggle = section.getByTestId('estimate-matches-toggle');
  await expect(toggle).toHaveText('13 past sales');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(matches).toHaveCount(0);
  await toggle.click();
  await expect(matches).toHaveCount(13);
  await expect(section.getByTestId('estimate-scan')).toContainText('Scanned 3 page(s)');
  await expect(section.getByTestId('estimate-scan')).toContainText('no more results');
  await expect(section.getByRole('link', { name: /Open the search on bidfax/ })).toHaveAttribute(
    'href',
    'https://en.bidfax.info/toyota/camry/f/from-year=2019/to-year=2019/',
  );
  // lot trim is SE → every match is an SE with a link to its bidfax page
  for (let i = 0; i < 13; i++) {
    await expect(matches.nth(i)).toContainText(/Se · 2\.5L/);
    await expect(matches.nth(i).getByRole('link', { name: 'bidfax' })).toHaveAttribute('href', /bidfax\.info\/toyota\/camry\/\d+-/);
  }
  await expect(section.getByTestId('estimate-average')).toHaveText('$5,363');
  await expect(section.getByTestId('estimate-count')).toHaveText('13 / 13');

  // the average becomes the default purchase price
  await expect(sheet.getByTestId('bid-source')).toHaveText('Average of past bidfax sales.');
  await expect(sheet.getByTestId('usd-subtotal')).toHaveText('$10,008.84');

  // exclude the first (newest) sale → average and cost update
  await matches.first().getByRole('checkbox').click();
  await expect(section.getByTestId('estimate-count')).toHaveText('12 / 13');
  await expect(section.getByTestId('estimate-average')).toHaveText('$5,360');
  await expect(sheet.getByTestId('usd-subtotal')).toHaveText('$10,004.59');

  // the button turns into Refresh; reopening keeps matches and the exclusion
  await expect(section.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog').getByTestId('estimate-count')).toHaveText('12 / 13');
  await expect(page.getByRole('dialog').getByTestId('estimate-match')).toHaveCount(0);
  await page.getByRole('dialog').getByTestId('estimate-matches-toggle').click();
  await expect(page.getByRole('dialog').getByTestId('estimate-match').first().getByRole('checkbox')).not.toBeChecked();
});

test('bidfax estimate shows the empty state when no past sales match', async ({ page }) => {
  await page.goto('/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020');
  await expect(page.getByTestId('lot-row').first()).toBeVisible();
  // a 2020 lot: only 2019 listing pages are recorded, so the scan finds nothing
  await page.goto(`/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020&lot=${encodeURIComponent('copart:65095026')}`);
  const section = page.getByRole('dialog').getByTestId('estimate-section');
  await section.getByRole('button', { name: 'Estimate price' }).click();
  // 2020 listing pages are not recorded → empty result, no error
  await expect(section.getByText(/No past sales matched this lot/)).toBeVisible();
  await expect(section.getByTestId('estimate-error')).toBeHidden();
});
