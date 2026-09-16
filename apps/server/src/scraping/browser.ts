import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';

export interface BrowserManagerOptions {
  /** Root dir; each profile gets its own persistent sub-directory (cookies, logins). */
  profilesDir: string;
  headless?: boolean;
}

let userAgentPromise: Promise<string> | undefined;

/**
 * A regular desktop Chrome UA matching the bundled Chromium version. The default headless UA
 * contains "HeadlessChrome", which Copart's bot protection rejects.
 */
function realisticUserAgent(): Promise<string> {
  userAgentPromise ??= chromium.launch({ channel: 'chromium' }).then(async (browser) => {
    const major = browser.version().split('.')[0];
    await browser.close();
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  });
  return userAgentPromise;
}

/**
 * Lazily launches one persistent Chromium context per profile and reuses it. A persistent
 * profile keeps cookies, so bot-protection tokens and a manual Copart login survive restarts.
 * Uses the full Chromium "new headless" mode, which is much harder to fingerprint than the
 * headless shell.
 */
export function createBrowserManager({ profilesDir, headless = true }: BrowserManagerOptions) {
  const contexts = new Map<string, Promise<BrowserContext>>();
  const sessionPages = new Map<string, Promise<Page>>();

  function getContext(profile: string): Promise<BrowserContext> {
    let ctx = contexts.get(profile);
    if (!ctx) {
      ctx = realisticUserAgent()
        .then((userAgent) =>
          chromium.launchPersistentContext(path.join(profilesDir, profile), {
            channel: 'chromium',
            headless,
            userAgent,
            locale: 'en-US',
            viewport: { width: 1366, height: 900 },
            args: ['--disable-blink-features=AutomationControlled'],
          }),
        )
        .then((context) => {
          context.on('close', () => {
            contexts.delete(profile);
            sessionPages.delete(profile);
          });
          return context;
        });
      ctx.catch(() => contexts.delete(profile));
      contexts.set(profile, ctx);
    }
    return ctx;
  }

  /** Runs `fn` in a fresh page that is closed afterwards. */
  async function withPage<T>(profile: string, fn: (page: Page) => Promise<T>): Promise<T> {
    const context = await getContext(profile);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /**
   * A long-lived page per profile, kept on the site so in-page `fetch` calls carry the site's
   * cookies/tokens. `bootstrap` navigates it when it's new or was closed.
   */
  async function sessionPage(profile: string, bootstrap: (page: Page) => Promise<void>): Promise<Page> {
    const existing = sessionPages.get(profile);
    if (existing) {
      const page = await existing.catch(() => null);
      if (page && !page.isClosed()) return page;
      sessionPages.delete(profile);
    }
    const created = (async () => {
      const context = await getContext(profile);
      const page = await context.newPage();
      page.setDefaultTimeout(45_000);
      await bootstrap(page);
      return page;
    })();
    created.catch(() => sessionPages.delete(profile));
    sessionPages.set(profile, created);
    return created;
  }

  async function resetSession(profile: string) {
    const page = await sessionPages.get(profile)?.catch(() => null);
    sessionPages.delete(profile);
    await page?.close().catch(() => undefined);
  }

  async function closeProfile(profile: string) {
    const ctx = contexts.get(profile);
    contexts.delete(profile);
    sessionPages.delete(profile);
    if (ctx) await (await ctx).close().catch(() => undefined);
  }

  async function closeAll() {
    await Promise.all([...contexts.keys()].map(closeProfile));
  }

  return { getContext, withPage, sessionPage, resetSession, closeProfile, closeAll };
}

export type BrowserManager = ReturnType<typeof createBrowserManager>;
