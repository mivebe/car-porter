import type { Page } from '@playwright/test';
import { expect, test } from './test';

async function pick(page: Page, label: string, search: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByPlaceholder(/Search (manufacturers|models)/).fill(search);
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByPlaceholder(/Search (manufacturers|models)/)).toHaveCount(0);
}

async function pickYear(page: Page, label: string, year: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('listbox', { name: label }).getByRole('option', { name: year, exact: true }).click();
  await expect(page.getByRole('listbox', { name: label })).toHaveCount(0);
}

test.describe('lot search', () => {
  test('searches without make or model, and validates years', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('combobox', { name: 'Year from' })).toHaveText('Any');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\?all=1$/);
    await expect(page.getByText('No lots match these filters.')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    // a trim needs a model, and goes when the make or model is cleared
    const trim = page.getByLabel('Trim');
    await expect(trim).toBeDisabled();
    await pick(page, 'Manufacturer', 'toyo', 'Toyota');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\?make=Toyota$/);
    await pick(page, 'Model', 'cam', 'Camry');
    await trim.fill('SE');
    await page.getByRole('button', { name: 'Clear model' }).click();
    await expect(trim).toHaveValue('');
    await expect(trim).toBeDisabled();
    await pick(page, 'Model', 'cam', 'Camry');
    await trim.fill('SE');
    await page.getByRole('button', { name: 'Clear manufacturer' }).click();
    await expect(trim).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'Model' })).toBeDisabled();

    // "to" can't be earlier than "from", and follows it when "from" moves past it
    await pickYear(page, 'Year to', '2019');
    await pickYear(page, 'Year from', '2021');
    await expect(page.getByRole('combobox', { name: 'Year to' })).toHaveText('2021');
    await page.getByRole('combobox', { name: 'Year to' }).click();
    await expect(page.getByRole('listbox', { name: 'Year to' }).getByRole('option', { name: '2020', exact: true })).toBeDisabled();
    await page.getByLabel('Type a year').fill('2023');
    await page.getByLabel('Type a year').press('Enter');
    await expect(page.getByRole('combobox', { name: 'Year to' })).toHaveText('2023');
    await expect(page.getByText('Enter a valid year.')).toHaveCount(0);
  });

  test('searches Copart + IAAI, filters by source, sorts and loads more', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Set the filters you need/)).toBeVisible();

    await pick(page, 'Manufacturer', 'toyo', 'Toyota');
    await pick(page, 'Model', 'cam', 'Camry');
    await pickYear(page, 'Year from', '2018');
    await pickYear(page, 'Year to', '2020');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page).toHaveURL(/make=Toyota&model=Camry&yearFrom=2018&yearTo=2020/);
    const rows = page.getByTestId('lot-row');
    await expect(rows).toHaveCount(55);
    await expect(page.getByTestId('source-status-Copart')).toContainText('1,661');
    await expect(page.getByTestId('source-status-IAAI')).toContainText('1,362');
    await expect(page.getByText('55 lots loaded')).toBeVisible();

    await page.getByRole('tab', { name: 'IAAI' }).click();
    await expect(rows).toHaveCount(30);
    await expect(rows.first()).toContainText('IAAI');

    await page.getByRole('tab', { name: 'All' }).click();
    await page.getByRole('combobox', { name: 'Sort by' }).click();
    await page.getByRole('option', { name: 'Newest year' }).click();
    await expect(rows.first()).toContainText('2020');

    // page 2 exists only for IAAI in the fixtures
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByText('65 lots loaded')).toBeVisible();
    await expect(rows).toHaveCount(65);

    // reload keeps the search from the URL and it is served from the server cache
    await page.reload();
    await expect(rows).toHaveCount(55);

    // selecting a lot is reflected in the URL (detail panel comes in task 18)
    await rows.first().click();
    await expect(page).toHaveURL(/[?&]lot=/);
  });

  test('marks opened and tracked lots in the results', async ({ page, request }) => {
    const marksLoaded = page.waitForResponse((r) => r.url().includes('/api/lots/marks'));
    await page.goto('/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020');
    await marksLoaded;
    // other specs share the database, so pick a lot nobody has opened or tracked
    const row = page.locator('[data-testid="lot-row"]:not([data-opened]):not([data-tracked])').first();
    const lotNumber = (await row.locator('[data-column="vehicle"]').innerText()).match(/#(\d+)/)![1]!;
    const same = page.getByTestId('lot-row').filter({ hasText: `#${lotNumber}` });

    await same.click();
    await expect(page).toHaveURL(/[?&]lot=/);
    const lotId = new URL(page.url()).searchParams.get('lot')!;
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Track', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Tracked', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await expect(same).toHaveAttribute('data-opened', 'true');
    await expect(same).toHaveAttribute('data-tracked', 'true');
    await expect(same.getByLabel('Tracked')).toBeVisible();

    // the marks come from the server, so they survive a reload
    await page.reload();
    await expect(same).toHaveAttribute('data-opened', 'true');
    expect((await request.delete(`/api/tracked/${encodeURIComponent(lotId)}`)).ok()).toBe(true);
  });

  test('narrows by trim and IAAI market, kept in the URL', async ({ page }) => {
    await page.goto('/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020');
    await expect(page.getByTestId('lot-row')).toHaveCount(55);

    await page.getByLabel('Trim').fill('XSE');
    // US only unless more are ticked
    await expect(page.getByRole('button', { name: 'IAAI market' })).toHaveText('US');
    await page.getByRole('button', { name: 'IAAI market' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Canada' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'IAAI market' })).toHaveText('US, Canada');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page).toHaveURL(/trim=XSE&iaaiMarkets=us%2Cca/);
    const rows = page.getByTestId('lot-row');
    // the previous 55 rows, then a loading state, give way to the narrowed results
    await expect.poll(async () => {
      const n = await rows.count();
      return n > 0 && n < 55;
    }).toBe(true);
    const count = await rows.count();
    for (let i = 0; i < count; i++) await expect(rows.nth(i)).toContainText('XSE');

    await page.reload();
    await expect(page.getByLabel('Trim')).toHaveValue('XSE');
    await expect(page.getByRole('button', { name: 'IAAI market' })).toHaveText('US, Canada');
  });

  test('filters by body style, transmission and engine', async ({ page }) => {
    await page.goto('/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020');
    await expect(page.getByTestId('lot-row')).toHaveCount(55);

    await page.getByRole('combobox', { name: 'Body style' }).click();
    await page.getByRole('option', { name: 'Sedan' }).click();
    await page.getByRole('combobox', { name: 'Transmission' }).click();
    await page.getByRole('option', { name: 'Automatic' }).click();
    await page.getByLabel('Engine, L').fill('9.99');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('Liters, e.g. 2.0 or 6.2.')).toBeVisible();

    await page.getByLabel('Engine, L').fill('3,5');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/bodyStyle=Sedan&transmission=automatic&engine=3\.5/);
    const rows = page.getByTestId('lot-row');
    // the previous 55 rows, then a loading state, give way to the filtered results
    await expect.poll(async () => {
      const n = await rows.count();
      return n > 0 && n < 55;
    }).toBe(true);

    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Body style' })).toHaveText('Sedan');
    await expect(page.getByRole('combobox', { name: 'Transmission' })).toHaveText('Automatic');
    await expect(page.getByLabel('Engine, L')).toHaveValue('3.5');
  });

  test('searches every year when none are chosen, and a year can be set back to Any', async ({ page }) => {
    await page.goto('/?make=Toyota&model=Camry&yearFrom=2019&yearTo=2019');
    await page.getByRole('combobox', { name: 'Year from' }).click();
    await page.getByRole('listbox', { name: 'Year from' }).getByRole('option', { name: 'Any' }).click();
    await page.getByRole('combobox', { name: 'Year to' }).click();
    await page.getByRole('listbox', { name: 'Year to' }).getByRole('option', { name: 'Any' }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\?make=Toyota&model=Camry$/);
    await expect(page.getByTestId('lot-row')).toHaveCount(55);
  });

  test('narrowing to a single year only shows that year', async ({ page }) => {
    await page.goto('/?make=Toyota&model=Camry&yearFrom=2019&yearTo=2019');
    const rows = page.getByTestId('lot-row');
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    for (let i = 0; i < count; i++) await expect(rows.nth(i)).toContainText('2019');
  });

  test('shows the empty state for a search without results', async ({ page }) => {
    await page.goto('/?make=Honda&model=Civic&yearFrom=2018&yearTo=2020');
    await expect(page.getByText('No lots match these filters.')).toBeVisible();
    await expect(page.getByTestId('source-status-Copart')).toContainText('0');
  });

  test('re-runs and removes recent searches', async ({ page }) => {
    await page.goto('/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020');
    await expect(page.getByTestId('lot-row').first()).toBeVisible();
    await page.goto('/?make=Toyota&model=Camry&yearFrom=2019&yearTo=2019&transmission=automatic');
    await expect(page.getByTestId('lot-row').first()).toBeVisible();

    await page.getByRole('button', { name: 'Recent' }).click();
    const items = page.getByRole('menuitem');
    await expect(items.nth(0)).toContainText('Toyota Camry 2019');
    await expect(items.nth(0)).toContainText('Automatic');
    await items.filter({ hasText: 'Toyota Camry 2018–2020' }).click();
    await expect(page).toHaveURL(/yearFrom=2018&yearTo=2020$/);

    await page.getByRole('button', { name: 'Recent' }).click();
    await expect(items.nth(0)).toContainText('Toyota Camry 2018–2020');
    await page.getByRole('button', { name: 'Remove' }).first().click();
    await expect(items.filter({ hasText: '2018–2020' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Clear all' }).click();
    await expect(page.getByRole('button', { name: 'Recent' })).toBeDisabled();
  });

  test('shows, hides and reorders result columns, kept across reloads', async ({ page }) => {
    await page.goto('/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020');
    await expect(page.getByTestId('lot-row')).toHaveCount(55);
    const headers = page.getByRole('columnheader');
    const defaults = [
      '',
      'Vehicle',
      'Damage / title',
      'Price',
      'Sale date',
      'Past auctions',
      'Avg. sold price',
      'BG market',
    ];
    await expect(headers).toHaveText(defaults);

    await page.getByRole('button', { name: 'Columns' }).click();
    const picker = page.getByTestId('column-picker');
    await expect(picker.getByRole('checkbox', { name: 'Vehicle' })).toBeDisabled();
    await picker.getByRole('checkbox', { name: 'BG market' }).click();
    await picker.getByRole('checkbox', { name: 'History' }).click();
    await picker.getByRole('checkbox', { name: 'Cost to BG' }).click();
    await picker.getByRole('button', { name: 'Move Sale date up' }).click();
    await page.keyboard.press('Escape');

    const expected = [
      '',
      'Vehicle',
      'Damage / title',
      'Sale date',
      'Price',
      'Past auctions',
      'Avg. sold price',
      'History',
      'Cost to BG',
    ];
    await expect(headers).toHaveText(expected);
    // other specs' scans are shared, so the values depend on what ran before
    const row = page
      .getByTestId('lot-row')
      .filter({ has: page.locator('[data-column="price"]', { hasText: 'current bid' }) })
      .first();
    await expect(row.locator('[data-column="history"]')).toHaveText(/^(-|\d+)$/);
    await expect(row.locator('[data-column="costBg"]')).toHaveText(/^€[\d,]+bid \$[\d,]+ \(/);

    await page.reload();
    await expect(headers).toHaveText(expected);

    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('button', { name: 'Reset columns' }).click();
    await expect(headers).toHaveText(defaults);
  });
});
