import type { Page, Response } from 'patchright';
import type { BrowserManager } from './browser.ts';
import { detectChallenge, SourceError } from './errors.ts';
import type { SourceQueue } from './source-queue.ts';

/** Loads a page and returns its HTML. */
export type HtmlFetcher = (url: string) => Promise<string>;

/** Per attempt. The check normally clears in ~5 s; when it sticks, a reload clears it. */
const CHALLENGE_WAIT_MS = 20_000;
const CHALLENGE_ATTEMPTS = 3;

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
 * Runs `navigate` and waits out Cloudflare's non-interactive check, reloading when it sticks.
 * Returns the final HTML and response, or null HTML when the check never cleared.
 */
export async function loadThroughChallenge(
  page: Page,
  navigate: () => Promise<Response | null>,
): Promise<{ html: string | null; response: Response | null }> {
  let response = await navigate();
  let html: string | null = null;
  for (let attempt = 1; attempt <= CHALLENGE_ATTEMPTS && html === null; attempt++) {
    if (attempt > 1) response = await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    html = await waitForContent(page, CHALLENGE_WAIT_MS);
  }
  return { html, response };
}

/**
 * Fetches server-rendered pages through a long-lived page of a persistent profile (so
 * cf_clearance is reused), waiting out Cloudflare's non-interactive check. `check` may throw a
 * SourceError for site-specific block pages; the session is reset when it does.
 */
export function createPageFetcher(options: {
  browser: BrowserManager;
  queue: SourceQueue;
  source: string;
  profile?: string;
  check?: (html: string, response: Response | null) => void;
  /**
   * Return the raw response body instead of the rendered DOM: for JSON endpoints, and for pages
   * whose embedded state script is removed during hydration.
   */
  raw?: boolean;
}): HtmlFetcher {
  const { browser, queue, source, profile = source, check, raw = false } = options;
  return (url) =>
    queue.run(source, async () => {
      const page = await browser.sessionPage(profile, async () => undefined);
      const { html, response } = await loadThroughChallenge(page, () =>
        page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }),
      );
      const content = await verifyLoaded({ browser, source, profile, check }, html, response);
      if (!raw || !response) return content;
      if (response.status() === 404) throw new SourceError('not_found', `${source}: ${url} not found`);
      return response.text();
    });
}

/** Throws `blocked` for an uncleared challenge and runs the site check, resetting the session on blocks. */
export async function verifyLoaded(
  options: { browser: BrowserManager; source: string; profile: string; check?: (html: string, response: Response | null) => void },
  html: string | null,
  response: Response | null,
): Promise<string> {
  const { browser, source, profile, check } = options;
  if (html === null) {
    await browser.resetSession(profile);
    throw new SourceError('blocked', `${source}: Cloudflare challenge did not clear`);
  }
  try {
    check?.(html, response);
  } catch (err) {
    if (err instanceof SourceError && err.code === 'blocked') await browser.resetSession(profile);
    throw err;
  }
  return html;
}
