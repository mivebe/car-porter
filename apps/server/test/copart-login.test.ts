import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { BrowserManager } from '../src/scraping/browser.ts';
import { createSourceQueue } from '../src/scraping/source-queue.ts';
import { COPART_LOGIN_URL, createCopartLogin } from '../src/sources/copart.ts';

describe('Copart login window', () => {
  it('opens one visible window on the copart profile and reports when it is closed', async () => {
    let close!: () => void;
    const openWindow = vi.fn(async () => ({
      closed: new Promise<void>((resolve) => (close = resolve)),
    }));
    const login = createCopartLogin(
      { openWindow } as unknown as BrowserManager,
      createSourceQueue({ delay: () => ({ minMs: 0, maxMs: 0 }) }),
    );

    expect(login.status()).toEqual({ windowOpen: false });
    expect(await login.open()).toEqual({ windowOpen: true });
    expect(await login.open()).toEqual({ windowOpen: true });
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith('copart', COPART_LOGIN_URL);

    close();
    await vi.waitFor(() => expect(login.status()).toEqual({ windowOpen: false }));
    await login.open();
    expect(openWindow).toHaveBeenCalledTimes(2);
  });

  describe('/api/copart/login', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;
    afterEach(async () => app.close());

    it('reports the status and opens the window (mock sources)', async () => {
      app = await buildApp({ mockSources: true });
      expect((await app.inject({ method: 'GET', url: '/api/copart/login' })).json()).toEqual({
        windowOpen: false,
      });
      const res = await app.inject({ method: 'POST', url: '/api/copart/login' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ windowOpen: true });
      expect((await app.inject({ method: 'GET', url: '/api/copart/login' })).json()).toEqual({
        windowOpen: true,
      });
    });

    it('maps a browser failure to 502', async () => {
      app = await buildApp({
        overrides: {
          copartLogin: {
            status: () => ({ windowOpen: false }),
            open: async () => {
              throw new Error('Chrome is not installed');
            },
          },
        },
      });
      const res = await app.inject({ method: 'POST', url: '/api/copart/login' });
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toMatchObject({
        message: expect.stringContaining('Chrome is not installed'),
      });
    });
  });
});
