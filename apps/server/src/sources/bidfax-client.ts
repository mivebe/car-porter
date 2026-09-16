import type { Page } from 'patchright';
import type { BrowserManager } from '../scraping/browser.ts';
import { detectChallenge, SourceError } from '../scraping/errors.ts';
import type { SourceQueue } from '../scraping/source-queue.ts';

export const BIDFAX_ORIGIN = 'https://bidfax.info';
const PROFILE = 'bidfax';
/** Per attempt. The check normally clears in ~5 s; when it sticks, a reload clears it. */
const CHALLENGE_WAIT_MS = 20_000;
const CHALLENGE_ATTEMPTS = 3;

/** Loads a bidfax page and returns its HTML. */
export type HtmlFetcher = (url: string) => Promise<string>;

/** nginx "403 Forbidden" bidfax serves to clients it rejects (e.g. a HeadlessChrome UA). */
export function isForbiddenPage(html: string): boolean {
  return html.length < 5000 && /<title>\s*403 Forbidden\s*<\/title>/i.test(html);
}

/** Waits until the page holds real content; '' (read during a Cloudflare reload) counts as pending. */
async function waitForContent(page: Page, timeoutMs: number): Promise<string | null> {
  const started = Date.now();
  for (;;) {
    const html = await page.content().catch(() => '');
    if (html && !detectChallenge(html)) return html;
    if (Date.now() - started >= timeoutMs) return null;
    await page.waitForTimeout(1000);
  }
}

/**
 * Navigates a long-lived bidfax page (so cf_clearance is reused) and waits for Cloudflare's
 * non-interactive check. Pages are plain server-rendered HTML.
 */
export function createBidfaxFetcher(browser: BrowserManager, queue: SourceQueue): HtmlFetcher {
  return (url) =>
    queue.run('bidfax', async () => {
      const page = await browser.sessionPage(PROFILE, async () => undefined);
      let response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      let html: string | null = null;
      for (let attempt = 1; attempt <= CHALLENGE_ATTEMPTS && html === null; attempt++) {
        if (attempt > 1) response = await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
        html = await waitForContent(page, CHALLENGE_WAIT_MS);
      }

      if (html === null) {
        await browser.resetSession(PROFILE);
        throw new SourceError('blocked', 'bidfax: Cloudflare challenge did not clear');
      }
      // don't trust response.status(): the Cloudflare challenge response itself is a 403
      if (isForbiddenPage(html)) {
        await browser.resetSession(PROFILE);
        throw new SourceError('blocked', 'bidfax: 403 Forbidden');
      }
      if (response && response.status() >= 500 && !html.includes('thumbnail')) {
        throw new SourceError('network', `bidfax: HTTP ${response.status()}`);
      }
      return html;
    });
}
