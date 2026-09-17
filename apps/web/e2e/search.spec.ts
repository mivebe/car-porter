import type { Page } from '@playwright/test';
import { expect, test } from './test';

async function pick(page: Page, label: string, search: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByPlaceholder(/Search (manufacturers|models)/).fill(search);
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function pickYear(page: Page, label: string, year: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('listbox', { name: label }).getByRole('option', { name: year, exact: true }).click();
  await expect(page.getByRole('listbox', { name: label })).toHaveCount(0);
}

test.describe('lot search', () => {
  test('validates required filters', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('Choose a manufacturer.')).toBeVisible();
    await expect(page.getByText('Choose a model.')).toBeVisible();
    await expect(page.getByText('Enter a valid year.')).toHaveCount(2);

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
    await expect(page.getByText(/Choose a manufacturer, model and year range/)).toBeVisible();

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
});
