import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'patchright';

export interface BrowserManagerOptions {
  /** Root dir; each profile gets its own persistent sub-directory (cookies, logins). */
  profilesDir: string;
  headless?: boolean;
}

let userAgentPromise: Promise<string> | undefined;

/**
 * A regular desktop Chrome UA matching the installed Chrome version. Headless Chrome announces
 * itself as "HeadlessChrome", which bidfax's nginx answers with 403 even after Cloudflare passes.
 */
function realisticUserAgent(): Promise<string> {
  userAgentPromise ??= chromium.launch({ channel: 'chrome', headless: true }).then(async (browser) => {
    const major = browser.version().split('.')[0];
    await browser.close();
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  });
  userAgentPromise.catch(() => (userAgentPromise = undefined));
  return userAgentPromise;
}

/**
 * Lazily launches one persistent browser context per profile and reuses it.
 *
 * Uses Patchright (a Playwright fork without the CDP automation leaks) driving the installed
 * Google Chrome. Verified 2026-09-16: bidfax.info's Cloudflare Turnstile passes headless with no
 * interaction, while stock Playwright loops on the checkbox even when a human clicks it.
 * Persistent profiles keep cookies (cf_clearance, Copart/Imperva tokens) across restarts.
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
            channel: 'chrome',
            headless,
            // Patchright recommends no viewport/UA context overrides; set the UA on the process.
            viewport: null,
            args: [`--user-agent=${userAgent}`, '--lang=en-US'],
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
    if (ctx) await (await ctx.catch(() => null))?.close().catch(() => undefined);
  }

  async function closeAll() {
    await Promise.all([...contexts.keys()].map(closeProfile));
  }

  return { getContext, withPage, sessionPage, resetSession, closeProfile, closeAll };
}

export type BrowserManager = ReturnType<typeof createBrowserManager>;
