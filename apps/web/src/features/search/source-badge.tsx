import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { siteColor, type Site } from './site-color';

/** The site's name in its colour; the one mark for a site everywhere in the app. */
export function SourceBadge({ source, className }: { source: Site; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1 py-px text-[10px] leading-4 font-semibold tracking-wide uppercase',
        siteColor(source),
        className,
      )}
    >
      {t(`sources.${source}`)}
    </span>
  );
}
