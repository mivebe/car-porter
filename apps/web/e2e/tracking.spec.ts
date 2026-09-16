import { expect, test } from './test';

const SEARCH = '/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020';
const SE_2019 = 'iaai:45949142';
const LE_2020 = 'copart:65095026';

test('tracking: track from the sheet, list with verdicts, reopen, update and remove', async ({
  page,
  request,
}) => {
  await page.goto(SEARCH);
  await expect(page.getByTestId('lot-row').first()).toBeVisible();
  expect(
    (await request.post(`/api/lots/${encodeURIComponent(SE_2019)}/estimate`, { data: {} })).ok(),
  ).toBe(true);
  expect(
    (await request.post(`/api/lots/${encodeURIComponent(SE_2019)}/market`, { data: {} })).ok(),
  ).toBe(true);

  // no data for the 2020 lot → "not enough data"
  expect((await request.put(`/api/tracked/${encodeURIComponent(LE_2020)}`)).ok()).toBe(true);

  await page.goto(`${SEARCH}&lot=${encodeURIComponent(SE_2019)}`);
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Track', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Tracked', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await page.getByRole('link', { name: 'Tracking' }).click();
  const rows = page.getByTestId('tracked-row');
  await expect(rows).toHaveCount(2);
  // newest first
  const se = rows.first();
  await expect(se).toContainText('2019 Toyota Camry SE');
  await expect(se.getByTestId('tracked-estimate')).toContainText('13 sales');
  await expect(se.getByTestId('tracked-cost')).toContainText('bid');
  await expect(se.getByTestId('tracked-market')).toContainText('€17,936');
  await expect(se.getByTestId('tracked-margin')).toHaveText('€8,012');
  await expect(se.getByTestId('verdict-status')).toHaveText('Worth it');
  await expect(rows.nth(1).getByTestId('verdict-status')).toHaveText('Not enough data');
  await expect(rows.nth(1).getByTestId('tracked-margin')).toHaveText('—');

  // open the lot from the list, change the repair estimate, close → the list updates
  await se.click();
  await expect(page).toHaveURL(/\/tracking\?lot=/);
  await expect(sheet.getByRole('button', { name: 'Tracked', exact: true })).toBeVisible();
  await sheet.getByLabel('Repair estimate').fill('6000');
  await sheet.getByLabel('Repair estimate').press('Enter');
  await expect(sheet.getByTestId('verdict-status')).toHaveText('Borderline');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(se.getByTestId('tracked-margin')).toHaveText('€2,012');
  await expect(se.getByTestId('verdict-status')).toHaveText('Borderline');

  // untrack from the sheet, then remove the other row from the list
  await se.click();
  await sheet.getByRole('button', { name: 'Tracked', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Track', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(rows).toHaveCount(1);
  await rows
    .first()
    .getByRole('button', { name: /Stop tracking 2020 Toyota Camry LE/ })
    .click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByText(/No tracked lots yet/)).toBeVisible();
});
