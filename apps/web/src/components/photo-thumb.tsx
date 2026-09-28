import { useState } from 'react';
import { cn } from '@/lib/utils';

/** bidfax photos sit behind Cloudflare, so they load through the server's scraping session. */
function photoSrc(url: string): string {
  try {
    const { hostname } = new URL(url);
    if (hostname === 'bidfax.info' || hostname.endsWith('.bidfax.info')) {
      return `/api/photo?url=${encodeURIComponent(url)}`;
    }
  } catch {
    // not an absolute URL; use it as is
  }
  return url;
}

/** A small photo linking to its source; renders nothing when there's no photo or it fails to load. */
export function PhotoThumb({ url, href, alt, className }: { url: string | null; href?: string; alt: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!url || failedUrl === url) return null;

  const img = (
    <img
      src={photoSrc(url)}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailedUrl(url)}
      className={cn('h-14 w-20 rounded bg-muted object-cover', className)}
    />
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="shrink-0">
      {img}
    </a>
  ) : (
    <span className="shrink-0">{img}</span>
  );
}
