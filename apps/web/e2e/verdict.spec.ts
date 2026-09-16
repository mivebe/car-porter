import { expect, test } from './test';

const SEARCH = '/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020';
const lotUrl = (id: string) => `${SEARCH}&lot=${encodeURIComponent(id)}`;

test('verdict: not enough data lists what is missing', async ({ page }) => {
  await page.goto(SEARCH);
  await expect(page.getByTestId('lot-row').first()).toBeVisible();
  // 2020 LE: no recorded bidfax sales or BG listings for 2020
  await page.goto(lotUrl('copart:65095026'));

  const verdict = page.getByRole('dialog').getByTestId('verdict-section');
  await expect(verdict.getByTestId('verdict-status')).toHaveText('Not enough data');
  await expect(verdict.getByTestId('verdict-missing').getByRole('listitem')).toHaveText([
    /No purchase price/,
    /No BG market price/,
  ]);
  await expect(verdict.getByTestId('verdict-margin')).toBeHidden();
});

test('verdict: margin from market average, landed cost and repair estimate', async ({
  page,
  request,
}) => {
  const id = 'iaai:45637680'; // 2019 Camry SE, 88 701 mi
  await page.goto(SEARCH);
  await expect(page.getByTestId('lot-row').first()).toBeVisible();
  // fetch the stored estimate + BG market for this lot up front (other specs may already have scanned)
  expect(
    (await request.post(`/api/lots/${encodeURIComponent(id)}/estimate`, { data: {} })).ok(),
  ).toBe(true);
  expect(
    (await request.post(`/api/lots/${encodeURIComponent(id)}/market`, { data: {} })).ok(),
  ).toBe(true);
  await page.goto(lotUrl(id));

  const sheet = page.getByRole('dialog');
  const verdict = sheet.getByTestId('verdict-section');
  await expect(sheet.getByTestId('cost-total')).toHaveText('€9,923.92');
  await expect(sheet.getByTestId('market-average')).toHaveText('€17,936');
  await expect(verdict.getByTestId('verdict-status')).toHaveText('Worth it');
  await expect(verdict.getByTestId('verdict-margin')).toHaveText('€8,012');
  await expect(verdict).toContainText('Worth it from a €3,000 margin.');

  const repair = sheet.getByLabel('Repair estimate');
  await repair.fill('6000');
  await repair.press('Enter');
  await expect(verdict.getByTestId('verdict-status')).toHaveText('Borderline');
  await expect(verdict.getByTestId('verdict-margin')).toHaveText('€2,012');

  await repair.fill('9000');
  await repair.press('Enter');
  await expect(verdict.getByTestId('verdict-status')).toHaveText('Not worth it');
  await expect(verdict.getByTestId('verdict-margin')).toHaveText('-€988');

  await repair.fill('0');
  await repair.press('Enter');
  await expect(verdict.getByTestId('verdict-status')).toHaveText('Worth it');
});
