import type { SourceErrorCode, SourceErrorInfo } from '@car-porter/core';

export class SourceError extends Error {
  constructor(
    readonly code: SourceErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SourceError';
  }
}

/** Maps any thrown value to a SourceErrorInfo suitable for API responses. */
export function toSourceErrorInfo(err: unknown): SourceErrorInfo {
  if (err instanceof SourceError) return { code: err.code, message: err.message };
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return { code: 'timeout', message: err.message };
    if (/net::ERR_|ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed/i.test(err.message)) {
      return { code: 'network', message: err.message };
    }
    return { code: 'unknown', message: err.message };
  }
  return { code: 'unknown', message: String(err) };
}

/** Markers that only ever appear on block/challenge pages. */
const STRONG_MARKERS: { pattern: RegExp; provider: string }[] = [
  { pattern: /<title>\s*Just a moment\.\.\.\s*<\/title>/i, provider: 'cloudflare' },
  { pattern: /cf-(?:browser-verification|chl-widget)/i, provider: 'cloudflare' },
  { pattern: /Attention Required! \| Cloudflare/i, provider: 'cloudflare' },
  { pattern: /Incapsula incident ID/i, provider: 'incapsula' },
  { pattern: /Request unsuccessful\. Incapsula/i, provider: 'incapsula' },
  { pattern: /geo\.captcha-delivery\.com/i, provider: 'datadome' },
  { pattern: /id="px-captcha"/i, provider: 'perimeterx' },
];

/**
 * Markers that real pages also embed (bot-protection scripts); they only indicate a block when
 * the document is tiny, i.e. there is no actual content around them.
 */
const WEAK_MARKERS: { pattern: RegExp; provider: string }[] = [
  { pattern: /_Incapsula_Resource/i, provider: 'incapsula' },
  { pattern: /cdn-cgi\/challenge-platform/i, provider: 'cloudflare' },
];
const WEAK_MARKER_MAX_LENGTH = 15_000;

/** Returns the bot-protection provider if the HTML is a challenge/block page, else null. */
export function detectChallenge(html: string): string | null {
  const strong = STRONG_MARKERS.find((m) => m.pattern.test(html));
  if (strong) return strong.provider;
  if (html.length > WEAK_MARKER_MAX_LENGTH) return null;
  return WEAK_MARKERS.find((m) => m.pattern.test(html))?.provider ?? null;
}

export function assertNotChallenged(html: string, source: string) {
  const provider = detectChallenge(html);
  if (provider) throw new SourceError('blocked', `${source}: blocked by ${provider} challenge`);
}
