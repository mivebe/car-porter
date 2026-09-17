import type { SourceErrorInfo } from '@car-porter/core';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatNumber, formatRelative } from '@/lib/format';

export interface SourceStatusProps {
  label: string;
  ok: boolean;
  total?: number;
  fetchedAt?: string;
  fromCache?: boolean;
  stale?: boolean;
  error?: SourceErrorInfo;
  /** Site-specific make/model names the canonical search was expanded to. */
  matched?: { makes: string[]; models: string[] };
}

/** Per-source badge: result count + freshness, or a typed error with details in a tooltip. */
export function SourceStatusBadge({ label, ok, total, fetchedAt, fromCache, stale, error, matched }: SourceStatusProps) {
  const { t, i18n } = useTranslation();

  if (!ok && error) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive" className="gap-1" data-testid={`source-status-${label}`}>
            <AlertTriangle className="size-3" />
            {label}: {t(`sourceErrors.${error.code}`)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">{error.message}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className="gap-1" data-testid={`source-status-${label}`}>
          {stale ? <AlertTriangle className="size-3 text-warning" /> : fromCache ? <Clock className="size-3" /> : <CheckCircle2 className="size-3 text-success" />}
          {label}
          {total !== undefined && <span className="tabular-nums">· {formatNumber(total, i18n.language)}</span>}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div>
          {t('sourceStatus.fetched', { when: formatRelative(fetchedAt, i18n.language) })}
          {fromCache && ` · ${t('sourceStatus.cached')}`}
          {stale && error && ` · ${t('sourceStatus.stale', { error: t(`sourceErrors.${error.code}`) })}`}
        </div>
        {matched &&
          (matched.makes.length > 0 && matched.models.length > 0 ? (
            <div data-testid={`source-matched-${label}`}>
              {t('sourceStatus.matched', { makes: matched.makes.join(', '), models: matched.models.join(', ') })}
            </div>
          ) : (
            <div data-testid={`source-matched-${label}`}>{t('sourceStatus.noMatch')}</div>
          ))}
      </TooltipContent>
    </Tooltip>
  );
}
