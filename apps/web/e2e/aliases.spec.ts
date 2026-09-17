import { expect, test } from './test';

test('aliases: scan the sites, ignore unassigned makes, reassign a model to a new one and reset it', async ({ page }) => {
  await page.goto('/aliases');
  await expect(page.getByRole('heading', { name: 'Make & model aliases' })).toBeVisible();

  const scan = page.getByTestId('alias-scan');
  await scan.getByRole('button', { name: 'Scan all' }).click();
  await expect(scan.getByText(/Last scan finished/)).toBeVisible();
  await expect(scan.getByTestId('alias-scan-copart')).toContainText('Done');
  await expect(scan.getByTestId('alias-scan-iaai')).toContainText('Done');

  // unassigned makes, one row per site
  const rows = page.getByTestId('alias-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Copart');
  await expect(rows.nth(1)).toContainText('IAAI');
  await expect(rows.first()).toContainText('GREAT DANE TRAILERS');
  await expect(rows.first().getByTestId('alias-status')).toHaveText('Unassigned');
  await expect(page.getByTestId('nav-unassigned')).toHaveText('2');

  await page.getByRole('checkbox', { name: 'Select all' }).click();
  await page.getByTestId('alias-bulk').getByRole('button', { name: 'Ignore' }).click();
  await expect(page.getByTestId('aliases-empty')).toContainText('Nothing to assign');
  await expect(page.getByTestId('nav-unassigned')).toBeHidden();

  // models of one make, all statuses
  await page.getByRole('tab', { name: 'Models' }).click();
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'All statuses' }).click();
  await page.getByRole('combobox', { name: 'Make' }).click();
  await page.getByRole('option', { name: 'Mercedes-Benz', exact: true }).click();
  await page.getByRole('combobox', { name: 'Site' }).click();
  await page.getByRole('option', { name: 'IAAI' }).click();
  await expect(rows.filter({ hasText: 'Copart' })).toHaveCount(0);

  const c63 = rows.filter({ hasText: 'AMG C 63' });
  await expect(c63.getByTestId('alias-target')).toContainText('C-Class');
  await expect(c63.getByTestId('alias-status')).toHaveText('Automatic · rule');

  await c63.getByRole('button', { name: 'Reassign' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('assign-entries')).toContainText('AMG C 63');
  await expect(dialog.getByTestId('assign-selected')).toContainText('C-Class');
  await dialog.getByPlaceholder('Search models').fill('C 63 AMG');
  await dialog.getByRole('option', { name: 'Create "C 63 AMG"' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await expect(c63.getByTestId('alias-status')).toHaveText('Assigned by you');
  await expect(c63.getByTestId('alias-target')).toContainText('C 63 AMG');
  await expect(c63.getByTestId('alias-target')).toContainText('C-Class');

  // the new model is offered in the search form
  await page.getByRole('link', { name: 'Search' }).click();
  await page.getByRole('combobox', { name: 'Manufacturer' }).click();
  await page.getByPlaceholder(/Search manufacturers/).fill('merc');
  await page.getByRole('option', { name: 'Mercedes-Benz', exact: true }).click();
  await page.getByRole('combobox', { name: 'Model' }).click();
  await page.getByPlaceholder(/Search models/).fill('c 63');
  await expect(page.getByRole('option', { name: 'C 63 AMG', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goBack();
  await expect(c63.getByTestId('alias-status')).toHaveText('Assigned by you');
  await c63.getByRole('button', { name: 'Reset to automatic' }).click();
  await expect(c63.getByTestId('alias-status')).toHaveText('Automatic · rule');
});
