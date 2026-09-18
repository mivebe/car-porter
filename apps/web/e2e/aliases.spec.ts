import type { Locator, Page } from '@playwright/test';
import { expect, test } from './test';

/** Drags with real mouse moves (dnd-kit starts a drag after a few pixels); `during` runs before the drop. */
async function drag(page: Page, from: Locator, to: Locator, during?: () => Promise<void>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40), { steps: 12 });
  await during?.();
  await page.mouse.up();
}

const card = (column: Locator, name: string, source: 'copart' | 'iaai') =>
  column.locator(`[data-testid="alias-card"][data-name="${name}"][data-source="${source}"]`);

test('aliases: drag site names between our makes/models, the assigned column and the unassigned pool', async ({ page }) => {
  await page.goto('/aliases');
  await expect(page.getByRole('heading', { name: 'Make & model aliases' })).toBeVisible();

  await page.getByRole('button', { name: 'Scan all' }).click();
  await expect(page.getByText('Scan finished')).toBeVisible();

  const left = page.getByTestId('alias-canonical');
  const middle = page.getByTestId('alias-assigned');
  const pool = page.getByTestId('alias-pool');

  // unassigned site names wait on the right; motorcycle makes are recognised as not a car
  await expect(card(pool, 'GREAT DANE TRAILERS', 'copart')).toBeVisible();
  await expect(card(pool, 'GREAT DANE TRAILERS', 'iaai')).toBeVisible();
  await expect(pool.locator('[data-name="HARLEY-DAVIDSON"]')).toHaveCount(0);
  await expect(middle).toContainText('Select one of our makes');

  // dropping in the middle with nothing selected sends the card back
  await drag(page, card(pool, 'GREAT DANE TRAILERS', 'copart'), middle, async () => {
    await expect(page.getByTestId('alias-drop-label')).toHaveText('Select a make or model on the left first');
  });
  await expect(page.getByText('Select a make or model on the left first').last()).toBeVisible();
  await expect(card(pool, 'GREAT DANE TRAILERS', 'copart')).toBeVisible();

  // create a make of our own and assign into the middle
  await left.getByPlaceholder('Find or create a make').fill('Great Dane');
  await left.getByRole('button', { name: 'Create "Great Dane"' }).click();
  await expect(middle.getByRole('heading')).toHaveText('Searched as Great Dane');
  await drag(page, card(pool, 'GREAT DANE TRAILERS', 'copart'), middle, async () => {
    await expect(page.getByTestId('alias-drop-label')).toHaveText('Assign to Great Dane');
  });
  await expect(card(middle, 'GREAT DANE TRAILERS', 'copart')).toBeVisible();
  await expect(card(pool, 'GREAT DANE TRAILERS', 'copart')).toHaveCount(0);

  // dropping onto one of our makes on the left assigns there
  const greatDane = left.locator('[data-testid="alias-canonical-item"][data-name="Great Dane"]');
  await drag(page, card(pool, 'GREAT DANE TRAILERS', 'iaai'), greatDane, async () => {
    await expect(page.getByTestId('alias-drop-label')).toHaveText('Assign to Great Dane');
  });
  await expect(card(middle, 'GREAT DANE TRAILERS', 'iaai')).toBeVisible();
  await expect(greatDane).toContainText('2');

  // dragging back out to the right unassigns
  await drag(page, card(middle, 'GREAT DANE TRAILERS', 'copart'), pool, async () => {
    await expect(page.getByTestId('alias-drop-label')).toHaveText('Unassign');
  });
  await expect(card(pool, 'GREAT DANE TRAILERS', 'copart')).toBeVisible();
  await expect(card(middle, 'GREAT DANE TRAILERS', 'copart')).toHaveCount(0);

  // models of a make: move a site model from C-Class to E-Class
  await page.getByRole('tab', { name: 'Models' }).click();
  await left.locator('[data-testid="alias-make-pick"]', { hasText: 'Mercedes-Benz' }).click();
  await left.locator('[data-testid="alias-canonical-item"][data-name="C-Class"]').click();
  await expect(card(middle, 'AMG C 63', 'iaai')).toBeVisible();
  await expect(card(middle, 'C', 'copart')).toBeVisible();

  await left.getByPlaceholder('Find or create a model').fill('E-Class');
  const eClass = left.locator('[data-testid="alias-canonical-item"][data-name="E-Class"]');
  await drag(page, card(middle, 'AMG C 63', 'iaai'), eClass, async () => {
    await expect(page.getByTestId('alias-drop-label')).toHaveText('Move to E-Class');
  });
  await expect(card(middle, 'AMG C 63', 'iaai')).toHaveCount(0);
  await expect(card(middle, 'AMG C 63', 'copart')).toBeVisible();
  await eClass.click();
  await expect(middle.getByRole('heading')).toHaveText('Searched as E-Class');
  const moved = card(middle, 'AMG C 63', 'iaai');
  await expect(moved).toBeVisible();

  // details on hover, actions on click
  await moved.hover();
  const details = page.getByTestId('alias-details');
  await expect(details).toContainText('Searched as');
  await expect(details).toContainText('E-Class');
  await expect(details.getByRole('button', { name: 'Ignore' })).toHaveCount(0);
  await page.mouse.move(0, 0);
  await moved.click();
  await details.getByRole('button', { name: 'Reset to automatic' }).click();
  await expect(moved).toHaveCount(0);
});

test('aliases: a running scan shows per-site progress between the filters and the columns', async ({ page }) => {
  const running = {
    state: 'running',
    make: null,
    startedAt: '2026-09-17T08:52:50.134Z',
    finishedAt: null,
    sources: [
      { source: 'copart', phase: 'makes', done: 0, total: 0, requests: 34, current: '1998–2005', failed: [] },
      { source: 'iaai', phase: 'models', done: 53, total: 128, requests: 90, current: 'Lamborghini', failed: [] },
    ],
  };
  await page.route('**/api/aliases/scan', (route) => route.fulfill({ json: running }));
  await page.goto('/aliases');

  const progress = page.getByTestId('alias-scan-progress');
  await expect(page.getByRole('button', { name: 'Stop scan' })).toBeVisible();
  await expect(progress.getByTestId('alias-scan-copart')).toContainText('Reading makes');
  await expect(progress.getByTestId('alias-scan-copart')).toContainText('34 requests · 1998–2005');
  await expect(progress.getByTestId('alias-scan-iaai')).toContainText('Reading models');
  await expect(progress.getByTestId('alias-scan-iaai')).toContainText('53/128 · Lamborghini');
  // it sits between the filter row and the columns
  const progressBox = (await progress.boundingBox())!;
  expect((await page.getByRole('button', { name: 'Stop scan' }).boundingBox())!.y).toBeLessThan(progressBox.y);
  expect((await page.getByTestId('alias-pool').boundingBox())!.y).toBeGreaterThan(progressBox.y);
});

test('aliases: body style names map onto our body styles and can be moved', async ({ page }) => {
  await page.goto('/aliases?kind=body&status=all');
  await page.getByRole('button', { name: 'Scan all' }).click();
  await expect(page.getByText('Scan finished')).toBeVisible();

  const left = page.getByTestId('alias-canonical');
  const middle = page.getByTestId('alias-assigned');
  await expect(left.getByRole('heading')).toHaveText('Our body styles');
  const item = (name: string) => left.locator(`[data-testid="alias-canonical-item"][data-name="${name}"]`);

  await item('Sedan').click();
  await expect(middle.getByRole('heading')).toHaveText('Searched as Sedan');
  await expect(card(middle, 'SEDAN', 'copart')).toBeVisible();
  await expect(card(middle, 'Sedan 4 Dr.', 'iaai')).toBeVisible();

  // body styles without site names wait folded under the list
  await left.getByRole('button', { name: '7 without site names' }).click();
  await drag(page, card(middle, 'SEDAN', 'copart'), item('Wagon'), async () => {
    await expect(page.getByTestId('alias-drop-label')).toHaveText('Move to Wagon');
  });
  await expect(card(middle, 'SEDAN', 'copart')).toHaveCount(0);
  await item('Wagon').click();
  await drag(page, card(middle, 'SEDAN', 'copart'), item('Sedan'));
  await expect(card(middle, 'SEDAN', 'copart')).toHaveCount(0);
  await expect(item('Sedan')).toContainText('4');
});
