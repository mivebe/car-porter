import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { SourceError } from '../src/scraping/errors.ts';
import { isBidfaxPhotoUrl } from '../src/sources/bidfax-client.ts';

const PHOTO = 'https://bidfax.info/uploads/posts/2026-09/20/chevrolet-camaro-2020-1g1fh1r71l0148888-img01.jpg';
const route = (url: string) => `/api/photo?url=${encodeURIComponent(url)}`;

describe('photo proxy', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(() => app?.close());

  it('only accepts https bidfax photo URLs', () => {
    expect(isBidfaxPhotoUrl(PHOTO)).toBe(true);
    expect(isBidfaxPhotoUrl('https://en.bidfax.info/x.jpg')).toBe(true);
    expect(isBidfaxPhotoUrl('http://bidfax.info/x.jpg')).toBe(false);
    expect(isBidfaxPhotoUrl('https://evilbidfax.info/x.jpg')).toBe(false);
    expect(isBidfaxPhotoUrl('https://localhost/x.jpg')).toBe(false);
    expect(isBidfaxPhotoUrl('not a url')).toBe(false);
  });

  it('serves the photo with a long cache, 404s missing ones and 502s failures', async () => {
    const fetchPhoto = vi.fn(async (url: string) => {
      if (url.endsWith('missing.jpg')) return null;
      if (url.endsWith('blocked.jpg')) throw new SourceError('blocked', 'bidfax: photo HTTP 403');
      return { body: Buffer.from('jpeg-bytes'), contentType: 'image/jpeg' };
    });
    app = await buildApp({ mockSources: true, overrides: { photoFetcher: fetchPhoto } });

    const ok = await app.inject({ method: 'GET', url: route(PHOTO) });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.headers['cache-control']).toContain('max-age=');
    expect(ok.body).toBe('jpeg-bytes');
    expect(fetchPhoto).toHaveBeenCalledWith(PHOTO);

    expect((await app.inject({ method: 'GET', url: route('https://bidfax.info/missing.jpg') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: route('https://bidfax.info/blocked.jpg') })).statusCode).toBe(502);
    expect((await app.inject({ method: 'GET', url: route('https://example.com/a.jpg') })).statusCode).toBe(400);
    expect(fetchPhoto).toHaveBeenCalledTimes(3);
  });
});
