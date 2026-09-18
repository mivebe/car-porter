import type { Response } from 'patchright';
import type { BrowserManager } from '../scraping/browser.ts';
import { SourceError } from '../scraping/errors.ts';
import { createPageFetcher, loadThroughChallenge, verifyLoaded, type HtmlFetcher } from '../scraping/page-fetcher.ts';
import type { SourceQueue } from '../scraping/source-queue.ts';

export type { HtmlFetcher } from '../scraping/page-fetcher.ts';

/** The English site: its titles and labels are cleaner than the Russian default. */
export const BIDFAX_ORIGIN = 'https://en.bidfax.info';
const PROFILE = 'bidfax';

/** Runs bidfax's site search for a VIN or lot number and returns the results page HTML. */
export type BidfaxSearcher = (query: string) => Promise<string>;

/** nginx "403 Forbidden" bidfax serves to clients it rejects (e.g. a HeadlessChrome UA). */
export function isForbiddenPage(html: string): boolean {
  return html.length < 5000 && /<title>\s*403 Forbidden\s*<\/title>/i.test(html);
}

function checkPage(html: string, response: Response | null) {
  // don't trust response.status(): the Cloudflare challenge response itself is a 403
  if (isForbiddenPage(html)) throw new SourceError('blocked', 'bidfax: 403 Forbidden');
  if (response && response.status() >= 500 && !html.includes('thumbnail')) {
    throw new SourceError('network', `bidfax: HTTP ${response.status()}`);
  }
}

/** Loads bidfax pages (plain server-rendered HTML) behind Cloudflare's non-interactive check. */
export function createBidfaxFetcher(browser: BrowserManager, queue: SourceQueue): HtmlFetcher {
  return createPageFetcher({ browser, queue, source: 'bidfax', profile: PROFILE, check: checkPage });
}

/**
 * Searches through the site's own form: the search URL only answers with results when it carries
 * the reCAPTCHA v3 token the page's script adds on submit (verified 2026-09-16; a fresh profile
 * gets the home page without it). The form is on every page, so the session page is reused.
 */
export function createBidfaxSearcher(browser: BrowserManager, queue: SourceQueue): BidfaxSearcher {
  return (query) =>
    queue.run('bidfax', async () => {
      const page = await browser.sessionPage(PROFILE, async () => undefined);
      const options = { browser, source: 'bidfax', profile: PROFILE, check: checkPage };

      if (!page.url().startsWith(BIDFAX_ORIGIN) || (await page.locator('#search').count()) === 0) {
        const home = await loadThroughChallenge(page, () =>
          page.goto(`${BIDFAX_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 }),
        );
        await verifyLoaded(options, home.html, home.response);
      }

      await page.locator('#search').fill(query);
      const { html, response } = await loadThroughChallenge(page, async () => {
        const [navigation] = await Promise.all([
          page.waitForNavigation({ url: /[?&]do=search/, waitUntil: 'domcontentloaded', timeout: 60_000 }),
          page.locator('#submit').click(),
        ]);
        return navigation;
      });
      return verifyLoaded(options, html, response);
    });
}
