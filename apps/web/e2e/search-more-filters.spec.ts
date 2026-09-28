import { expect, test } from './test';

test.describe('more search filters', () => {
  test('are collapsed until opened, filter by condition and keys (any, has, none), and stay open once used', async ({ page }) => {
    await page.goto('/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020');
    await expect(page.getByTestId('lot-row')).toHaveCount(55);
    const toggle = page.getByRole('button', { name: 'More filters' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('combobox', { name: 'Condition' })).toHaveCount(0);

    await toggle.click();
    await page.getByRole('button', { name: 'Damage' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Front' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Side' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Damage' })).toHaveText('Front, Side');
    await page.getByRole('combobox', { name: 'Condition' }).click();
    await page.getByRole('option', { name: 'Runs & drives' }).click();
    await page.getByRole('combobox', { name: 'Keys' }).click();
    await page.getByRole('option', { name: 'Has keys' }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page).toHaveURL(/damage=front%2Cside&condition=runsDrives&keys=1/);
    const rows = page.getByTestId('lot-row');
    await expect.poll(async () => {
      const n = await rows.count();
      return n > 0 && n < 55;
    }).toBe(true);

    await page.reload();
    await expect(page.getByRole('button', { name: 'More filters (3)' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('combobox', { name: 'Condition' })).toHaveText('Runs & drives');
    await expect(page.getByRole('combobox', { name: 'Keys' })).toHaveText('Has keys');

    // no keys is its own filter
    await page.getByRole('combobox', { name: 'Keys' }).click();
    await page.getByRole('option', { name: 'No keys' }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/keys=0/);
  });
});
