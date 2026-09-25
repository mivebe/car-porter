import { expect, test } from './test';

const SEARCH = '/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020';
const LOT = 'iaai:45935296'; // 2019 Camry SE

test('settings: validation, save, effect on the verdict and market defaults, reset', async ({
  page,
  request,
}) => {
  await page.goto(SEARCH);
  await expect(page.getByTestId('lot-row').first()).toBeVisible();
  expect(
    (await request.post(`/api/lots/${encodeURIComponent(LOT)}/estimate`, { data: {} })).ok(),
  ).toBe(true);
  expect(
    (await request.post(`/api/lots/${encodeURIComponent(LOT)}/market`, { data: {} })).ok(),
  ).toBe(true);

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const save = page.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  await expect(page.getByLabel('Shipping USA → Rotterdam')).toHaveValue('2500');
  await expect(page.getByTestId('fee-total')).toHaveText('Total 40% · reduced 13.33%');
  await expect(page.getByLabel('Manual USD → EUR rate')).toHaveAttribute('placeholder', '0.8666');

  // validation
  await page.getByLabel('Shipping USA → Rotterdam').fill('abc');
  await expect(page.getByText('Enter a valid number.')).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByLabel('Shipping USA → Rotterdam').fill('2,500');
  await page.getByLabel('Maximum delay').fill('1000');
  await expect(page.getByText('Must be at least the minimum delay.')).toBeVisible();
  await page.getByLabel('Maximum delay').fill('4000');
  await expect(page.getByText('Fix the highlighted fields')).toBeHidden();

  // change the threshold, drop the third fee part, enable AutoScout24 by default
  await page.getByLabel('“Worth it” from a margin of').fill('9000');
  await page.getByRole('button', { name: 'Remove fee part 3' }).click();
  await expect(page.getByTestId('fee-total')).toHaveText('Total 30% · reduced 10%');
  await page.getByLabel('AutoScout24').click();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await save.click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await expect(save).toBeDisabled();

  await page.reload();
  await expect(page.getByLabel('“Worth it” from a margin of')).toHaveValue('9000');
  await expect(page.getByRole('textbox', { name: 'Part 3' })).toHaveCount(0);
  await expect(page.getByLabel('AutoScout24')).toBeChecked();

  // the lot uses the new fees, threshold and default marketplaces
  await page.goto(`${SEARCH}&lot=${encodeURIComponent(LOT)}`);
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Fees 10%')).toHaveCount(1);
  await expect(sheet.getByText('Fees 20%')).toHaveCount(1);
  await expect(sheet.getByTestId('market-section').getByLabel('AutoScout24')).toBeChecked();

  // back to the defaults
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(page.getByLabel('“Worth it” from a margin of')).toHaveValue('3000');
  await expect(page.getByRole('textbox', { name: 'Part 3' })).toHaveValue('10');
  await save.click();
  await expect(save).toBeDisabled();
  expect((await (await request.get('/api/settings')).json()).verdict.worthThresholdEur).toBe(3000);
});

test('settings: language, mode and theme are saved on the server; Copart login window', async ({
  page,
  browser,
}) => {
  await page.goto('/settings');
  await page.getByRole('combobox', { name: 'Light/dark mode' }).click();
  await page.getByRole('option', { name: 'Light' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('combobox', { name: 'Theme' }).click();
  await page.getByRole('option', { name: 'Petrol & Copper' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'petrol');
  await page.getByRole('combobox', { name: 'Language' }).click();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/settings') && r.request().method() === 'PATCH',
  );
  await page.getByRole('option', { name: 'Български' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible();
  await saved;

  // a fresh browser (no localStorage) gets the saved preferences
  const other = await browser.newContext();
  const fresh = await other.newPage();
  await fresh.goto('/settings');
  await expect(fresh.getByRole('heading', { name: 'Настройки' })).toBeVisible();
  await expect(fresh.locator('html')).not.toHaveClass(/dark/);
  await expect(fresh.locator('html')).toHaveAttribute('data-palette', 'petrol');
  await other.close();

  await page.getByRole('button', { name: 'Отвори прозорец за вход в Copart' }).click();
  await expect(page.getByTestId('copart-login-status')).toHaveText(
    'Прозорецът за вход е отворен. Влезте там и затворете прозореца.',
  );
});
