import { AUCTION_SOURCES, type AuctionSource, type HistoryEntry, type Lot } from '@car-porter/core';
import { AlertTriangle, ExternalLink, History, Loader2, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SourceBadge } from '@/features/search/source-badge';
import { formatDate, formatMoney, formatNumber, formatRelative, sentenceCase } from '@/lib/format';
import type { HistoryCheck, HistoryResponse } from './history-hooks';
import { Section } from './section';

interface HistorySectionProps {
  lot: Lot;
  data: HistoryResponse | undefined;
  running: boolean;
  runFailed: boolean;
  onRun: (refresh: boolean) => void;
}

const isAuctionSource = (value: string | null): value is AuctionSource =>
  (AUCTION_SOURCES as readonly string[]).includes(value ?? '');

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  sold: 'secondary',
  not_sold: 'destructive',
  on_approval: 'outline',
  upcoming: 'outline',
};

export function HistorySection({ lot, data, running, runFailed, onRun }: HistorySectionProps) {
  const { t } = useTranslation();
  const hasRun = !!data?.checks.some((c) => c.checkedAt || c.error);

  return (
    <Section
      icon={History}
      title={t('history.title')}
      testId="history-section"
      actions={
        <Button size="sm" variant={hasRun ? 'outline' : 'default'} onClick={() => onRun(hasRun)} disabled={running}>
          {running ? <Loader2 className="animate-spin" /> : hasRun ? <RefreshCw /> : <Search />}
          {hasRun ? t('history.refresh') : t('history.run')}
        </Button>
      }
    >
      {data && (
        <p className="text-sm text-muted-foreground" data-testid="history-vin">
          {data.vin ? (
            <>
              {t(data.vinSource === 'override' ? 'history.byPastedVin' : 'history.byLotVin', { lot: data.lotNumber })}{' '}
              <span className="font-mono text-foreground">{data.vin}</span>
            </>
          ) : (
            t('history.lotOnly', { lot: data.lotNumber })
          )}
        </p>
      )}

      {running && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" />
          {t('history.checking')}
        </p>
      )}

      {runFailed && (
        <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
          <AlertTriangle className="size-4" />
          {t('history.requestFailed')}
        </p>
      )}

      {hasRun && (
        <ul className="grid gap-1 text-xs text-muted-foreground" data-testid="history-checks">
          {data!.checks.map((check) => (
            <CheckLine key={`${check.site}:${check.query}`} check={check} />
          ))}
        </ul>
      )}

      {hasRun && data!.entries.length === 0 && !running && (
        <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
      )}

      {data && data.entries.length > 0 && (
        <ol className="grid gap-0 border-l pl-4" data-testid="history-entries">
          {data.entries.map((entry) => (
            <EntryItem key={entry.key} entry={entry} lot={lot} />
          ))}
        </ol>
      )}
    </Section>
  );
}

function CheckLine({ check }: { check: HistoryCheck }) {
  const { t, i18n } = useTranslation();
  const label = t('history.checkLabel', { site: t(`sources.${check.site}`), query: t(`history.queries.${check.query}`) });
  return (
    <li data-testid="history-check" className={check.error ? 'text-destructive' : undefined}>
      {label}
      {' · '}
      {check.error
        ? `${t(`sourceErrors.${check.error.code}`)}: ${check.error.message}`
        : check.checkedAt
          ? t('history.checked', { count: check.found ?? 0, when: formatRelative(check.checkedAt, i18n.language) })
          : t('history.notChecked')}
    </li>
  );
}

function EntryItem({ entry, lot }: { entry: HistoryEntry; lot: Lot }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isThisLot = entry.auction === lot.source && entry.lotNumber === lot.lotNumber;
  const details = [
    sentenceCase(entry.damage) || null,
    entry.odometerMiles != null ? t('units.miles', { value: formatNumber(entry.odometerMiles, lang) }) : null,
    entry.location,
  ].filter(Boolean);

  return (
    <li className="relative flex gap-3 py-2" data-testid="history-entry">
      <span className="absolute top-3.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-muted-foreground" />
      {entry.imageUrl && (
        <a href={entry.sources[0]?.url} target="_blank" rel="noreferrer" className="shrink-0">
          <img
            src={entry.imageUrl}
            alt={t('history.photo', { date: formatDate(entry.saleDate, lang) })}
            referrerPolicy="no-referrer"
            loading="lazy"
            className="h-14 w-20 rounded object-cover"
          />
        </a>
      )}
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium tabular-nums">{formatDate(entry.saleDate, lang)}</span>
          {isAuctionSource(entry.auction) ? (
            <SourceBadge source={entry.auction} />
          ) : (
            entry.auction && <Badge variant="outline">{entry.auction.toUpperCase()}</Badge>
          )}
          {entry.lotNumber && <span className="text-xs text-muted-foreground tabular-nums">#{entry.lotNumber}</span>}
          {isThisLot && <Badge variant="secondary">{t('history.thisLot')}</Badge>}
          <span className="ml-auto font-semibold tabular-nums" data-testid="history-price">
            {formatMoney(entry.finalPriceUsdCents, 'USD', lang)}
          </span>
          {entry.saleStatus && (
            <Badge variant={STATUS_VARIANT[entry.saleStatus] ?? 'outline'}>{t(`history.status.${entry.saleStatus}`)}</Badge>
          )}
        </div>
        {details.length > 0 && <div className="truncate text-xs text-muted-foreground">{details.join(' · ')}</div>}
        <div className="flex flex-wrap gap-3 text-xs">
          {entry.sources.map((source) => (
            <a
              key={source.recordId}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              {t(`sources.${source.site}`, { defaultValue: source.site })}
              <ExternalLink className="size-3" />
            </a>
          ))}
        </div>
      </div>
    </li>
  );
}
