import { ExternalLink, Gavel, Loader2, RefreshCw, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Disclosure } from '@/components/disclosure';
import { InlineMessage } from '@/components/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDate, formatMoney, formatNumber, formatRelative, milesToKm } from '@/lib/format';
import { cn } from '@/lib/utils';
import { estimateSummary, type EstimateResponse } from './estimate-hooks';
import { Section, Stat } from './section';

interface EstimateSectionProps {
  data: EstimateResponse | undefined;
  running: boolean;
  runFailed: boolean;
  onRun: (refresh: boolean) => void;
  onToggle: (recordId: string, included: boolean) => void;
}

export function EstimateSection({ data, running, runFailed, onRun, onToggle }: EstimateSectionProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const usd = (c: number | null | undefined) => formatMoney(c, 'USD', lang);
  const summary = estimateSummary(data);
  const excluded = new Set(data?.excludedIds ?? []);
  const hasScan = !!data?.scan;
  const [expanded, setExpanded] = useState(false);

  return (
    <Section
      icon={Gavel}
      title={t('estimate.title')}
      testId="estimate-section"
      actions={
        <Button size="sm" variant={hasScan ? 'outline' : 'default'} onClick={() => onRun(hasScan)} disabled={running}>
          {running ? <Loader2 className="animate-spin" /> : hasScan ? <RefreshCw /> : <Search />}
          {hasScan ? t('estimate.refresh') : t('estimate.run')}
        </Button>
      }
    >
      {running && (
        <InlineMessage tone="busy">{t('estimate.scanning')}</InlineMessage>
      )}

      {(data?.error || runFailed) && (
        <InlineMessage tone="destructive" data-testid="estimate-error">
          {data?.error ? `${t(`sourceErrors.${data.error.code}`)}: ${data.error.message}` : t('estimate.requestFailed')}
        </InlineMessage>
      )}

      {data?.scan && (
        <p className="text-xs text-muted-foreground" data-testid="estimate-scan">
          {t('estimate.scanInfo', {
            pages: data.scan.pagesScanned,
            when: formatRelative(data.scan.scannedAt, lang),
            reason: t(`estimate.stopReasons.${data.scan.stopReason}`),
          })}
          {data.searchUrl && (
            <>
              {' · '}
              <a href={data.searchUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                {t('estimate.openSearch')}
                <ExternalLink className="size-3" />
              </a>
            </>
          )}
        </p>
      )}

      {data && hasScan && data.matches.length === 0 && !running && (
        <p className="text-sm text-muted-foreground">{t('estimate.noMatches')}</p>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t('estimate.average')} value={usd(summary.average)} testId="estimate-average" />
          <Stat label={t('estimate.median')} value={usd(summary.median)} testId="estimate-median" />
          <Stat label={t('estimate.range')} value={`${usd(summary.min)} – ${usd(summary.max)}`} />
          <Stat
            label={t('estimate.included')}
            value={`${summary.count} / ${data!.matches.length}`}
            testId="estimate-count"
          />
        </div>
      )}
      {data && data.matches.length > 0 && !summary && (
        <p className="text-sm text-muted-foreground">{t('estimate.allExcluded')}</p>
      )}

      {data && data.matches.length > 0 && (
        <Disclosure
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          aria-controls="estimate-matches"
          data-testid="estimate-matches-toggle"
        >
          {t('estimate.sales', { count: data.matches.length })}
        </Disclosure>
      )}

      {data && data.matches.length > 0 && expanded && (
        <ul id="estimate-matches" className="divide-y rounded-lg border" data-testid="estimate-matches">
          {data.matches.map(({ record: r, unknown }) => {
            const included = !excluded.has(r.id);
            return (
              <li key={r.id} className={cn('flex items-start gap-3 px-3 py-2', !included && 'opacity-50')} data-testid="estimate-match">
                <Checkbox
                  className="mt-1"
                  checked={included}
                  onCheckedChange={(v) => onToggle(r.id, v === true)}
                  aria-label={t('estimate.include', { price: usd(r.finalPriceUsdCents), date: formatDate(r.saleDate, lang) })}
                />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums">{usd(r.finalPriceUsdCents)}</span>
                    {r.saleStatus && (
                      <Badge variant={r.saleStatus === 'sold' ? 'secondary' : 'outline'}>{t(`estimate.status.${r.saleStatus}`)}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{formatDate(r.saleDate, lang)}</span>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {t('sources.bidfax')}
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[
                      r.trim,
                      r.engine,
                      r.damage,
                      r.odometerMiles != null ? t('units.km', { value: formatNumber(milesToKm(r.odometerMiles), lang) }) : null,
                      r.auction?.toUpperCase(),
                      r.location,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {unknown.length > 0 && (
                    <div className="text-xs text-muted-foreground/80">
                      {t('estimate.unknown', { fields: unknown.map((u) => t(`estimate.criteria.${u}`)).join(', ') })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
