import { DEFAULT_SETTINGS } from '@car-porter/core';
import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * Every spec shares one mock server, and settings (including language and theme) and recent searches
 * live on it, so each test starts from the defaults.
 */
export const test = base.extend<{ defaultSettings: void }>({
  defaultSettings: [
    async ({ request }, use) => {
      const res = await request.patch('/api/settings', { data: DEFAULT_SETTINGS });
      if (!res.ok()) throw new Error(`resetting settings failed: ${res.status()}`);
      await request.delete('/api/searches/recent');
      await use();
    },
    { auto: true },
  ],
});
