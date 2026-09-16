import { expect, test } from '@playwright/test';

const SEARCH = '/?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020';

test.describe('lot detail + import cost', () => {
  test('opens a lot, calculates cost with toggles, persists inputs', async ({ page }) => {
    await page.goto(SEARCH);
    await page.getByRole('tab', { name: 'IAAI' }).click();
    // 2018 LE: no stored bidfax sales for it, so the price starts empty
    await page.getByTestId('lot-row').nth(1).click();

    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /2018 Toyota Camry LE/ })).toBeVisible();
    await expect(sheet.getByRole('link', { name: /Open on IAAI/ })).toHaveAttribute('href', /iaai\.com\/VehicleDetail\//);
    await expect(sheet.getByText('4T1B11HK2JU******').first()).toBeVisible();
    await expect(page).toHaveURL(/lot=iaai%3A45940294|lot=iaai:45940294/);

    // no bid for IAAI guests → enter a purchase price
    await expect(sheet.getByTestId('bid-source')).toHaveText('No price yet.');
    await sheet.getByLabel('Purchase price (bid)').fill('5,000');
    await sheet.getByLabel('Purchase price (bid)').press('Enter');

    // ECB fixture rate 2026-09-15: 1 EUR = 1.1539 USD
    await expect(sheet.getByTestId('usd-subtotal')).toHaveText('$9,500.00');
    await expect(sheet.getByTestId('cost-total')).toHaveText('€9,482.95');
    await expect(sheet.getByTestId('bid-source')).toHaveText('Your price.');
    await expect(sheet.getByText('Fees 10%')).toHaveCount(2);
    await expect(sheet.getByText('Fees 20%')).toBeVisible();

    await sheet.getByLabel('Reduced fees (÷3)').click();
    await expect(sheet.getByTestId('cost-total')).toHaveText('€8,327.45');
    await expect(sheet.getByText('Fees 6.67%')).toBeVisible();

    await sheet.getByLabel(/Sofia → anywhere in BG/).click();
    await expect(sheet.getByTestId('cost-total')).toHaveText('€8,077.45');

    // VIN paste with validation
    const vin = sheet.getByLabel('VIN from photos');
    await vin.fill('123');
    await expect(sheet.getByTestId('vin-status')).toContainText('Not a valid VIN (3/17');
    await vin.fill('1hgcm82633a004352');
    await vin.press('Enter');
    await expect(sheet.getByTestId('vin-status')).toContainText('Valid VIN');

    await sheet.getByLabel('Repair estimate').fill('1500');
    await sheet.getByLabel('Repair estimate').press('Enter');

    // close and reopen: everything was saved on the server
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/lot=/);

    await page.getByTestId('lot-row').nth(1).click();
    await expect(sheet.getByTestId('cost-total')).toHaveText('€8,077.45');
    await expect(sheet.getByLabel('VIN from photos')).toHaveValue('1HGCM82633A004352');
    await expect(sheet.getByLabel('Repair estimate')).toHaveValue('1500');
    await expect(sheet.getByLabel('Reduced fees (÷3)')).toBeChecked();

    // reset the override → back to "no price"
    await sheet.getByRole('button', { name: 'Reset to default price' }).click();
    await expect(sheet.getByTestId('bid-source')).toHaveText('No price yet.');
    await expect(sheet.getByTestId('cost-breakdown')).toBeHidden();
  });

  test('deep link opens the sheet directly and shows Bulgarian labels', async ({ page }) => {
    await page.goto(`${SEARCH}&lot=${encodeURIComponent('copart:65095026')}`);
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /2020 Toyota Camry LE/ })).toBeVisible();
    await expect(sheet.getByRole('link', { name: /Open on Copart/ })).toHaveAttribute('href', /copart\.com\/lot\/65095026/);

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitemradio', { name: 'Български' }).click();
    await page.getByTestId('lot-row').first().click();
    await expect(page.getByRole('dialog').getByText('Разходи за внос в България')).toBeVisible();
  });
});
