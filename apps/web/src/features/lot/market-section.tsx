import {
  MARKET_SOURCES,
  MARKET_YEAR_SPANS,
  type Lot,
  type LotInputs,
  type MarketGroup,
  type MarketMatchToggles,
  type MarketSource,
  type MarketSummary,
  type MarketYearSpan,
  type Settings,
} from '@car-porter/core';
import { ExternalLink, Loader2, RefreshCw, Search, Store } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Disclosure } from '@/components/disclosure';
import { InlineMessage } from '@/components/feedback';
import { PhotoThumb } from '@/components/photo-thumb';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SourceBadge } from '@/features/search/source-badge';
import { formatMoney, formatNumber, formatRelative, milesToKm } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MarketResponse, MarketSiteResult, StoredMarketListing } from './market-hooks';
import { Section, Stat } from './section';

interface MarketSectionProps {
  lot: Lot;
  inputs: LotInputs;
  settings: Settings;
  data: MarketResponse | undefined;
  /** Marketplaces used for this lot. */
  sites: MarketSource[];
  summary: MarketSummary;
  running: boolean;
  runFailed: boolean;
  onRun: (refresh: boolean) => void;
  onToggle: (listingId: string, included: boolean) => void;
  onChange: (patch: Pick<Partial<LotInputs>, 'marketMatch' | 'marketSources'>) => void;
}

export function MarketSection({ lot, inputs, settings, data, sites, summary, running, runFailed, onRun, onToggle, onChange }: MarketSectionProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const eur = (c: number | null | undefined) => formatMoney(c, 'EUR', lang);

  const excluded = new Set(data?.excludedIds ?? []);
  const status = (site: MarketSource) => data?.sites.find((s) => s.site === site);
  const hasRun = sites.some((site) => status(site)?.checkedAt || status(site)?.error);
  // refresh (bypassing the 24 h reuse) only once every chosen marketplace has been checked
  const allChecked = sites.length > 0 && sites.every((site) => status(site)?.checkedAt);

  const setSource = (site: MarketSource, enabled: boolean) =>
    onChange({
      marketSources: Object.fromEntries(MARKET_SOURCES.map((s) => [s, s === site ? enabled : sites.includes(s)])) as Record<
        MarketSource,
        boolean
      >,
    });
  const setMatch = (criterion: Exclude<keyof MarketMatchToggles, 'yearSpan'>, value: boolean) =>
    onChange({ marketMatch: { ...inputs.marketMatch, [criterion]: value } });
  const setYearSpan = (yearSpan: MarketYearSpan) => onChange({ marketMatch: { ...inputs.marketMatch, yearSpan } });

  return (
    <Section
      icon={Store}
      title={t('market.title')}
      testId="market-section"
      actions={
        <Button
          size="sm"
          variant={allChecked ? 'outline' : 'default'}
          onClick={() => onRun(allChecked)}
          disabled={running || sites.length === 0}
        >
          {running ? <Loader2 className="animate-spin" /> : allChecked ? <RefreshCw /> : <Search />}
          {allChecked ? t('market.refresh') : t('market.run')}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="grid content-start gap-2">
          <legend className="mb-1 text-sm font-medium">{t('market.sourcesLabel')}</legend>
          {MARKET_SOURCES.map((site) => (
            <div key={site} className="flex items-center justify-between gap-3">
              <Label htmlFor={`market-source-${site}`} className="font-normal">
                {t(`sources.${site}`)}
              </Label>
              <Switch id={`market-source-${site}`} checked={sites.includes(site)} onCheckedChange={(v) => setSource(site, v)} />
            </div>
          ))}
        </fieldset>
        <fieldset className="grid content-start gap-2">
          <legend className="mb-1 text-sm font-medium">{t('market.matchLabel')}</legend>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm" id="market-year-span-label">
              {t('market.match.year')}
            </span>
            <div className="flex rounded-md border p-0.5" role="group" aria-labelledby="market-year-span-label" data-testid="market-year-span">
              {MARKET_YEAR_SPANS.map((span) => (
                <button
                  key={span}
                  type="button"
                  aria-pressed={inputs.marketMatch.yearSpan === span}
                  onClick={() => setYearSpan(span)}
                  className={cn(
                    'rounded px-2 py-0.5 text-xs tabular-nums text-muted-foreground hover:text-foreground',
                    inputs.marketMatch.yearSpan === span && 'bg-primary text-primary-foreground hover:text-primary-foreground',
                  )}
                >
                  {span === 0 ? t('market.yearSpan.exact') : t('market.yearSpan.broad', { years: span })}
                </button>
              ))}
            </div>
          </div>
          {(['mileage', 'transmission', 'fuel'] as const).map((criterion) => (
            <div key={criterion} className="flex items-center justify-between gap-3">
              <Label htmlFor={`market-match-${criterion}`} className="font-normal">
                {t(`market.match.${criterion}`, {
                  range: formatNumber(settings.market.mileageRangeKm, lang),
                  km: lot.odometerMiles != null ? formatNumber(milesToKm(lot.odometerMiles), lang) : '-',
                })}
              </Label>
              <Switch
                id={`market-match-${criterion}`}
                checked={inputs.marketMatch[criterion]}
                onCheckedChange={(v) => setMatch(criterion, v)}
              />
            </div>
          ))}
        </fieldset>
      </div>

      {running && (
        <InlineMessage tone="busy">{t('market.searching')}</InlineMessage>
      )}
      {runFailed && (
        <InlineMessage tone="destructive">{t('market.requestFailed')}</InlineMessage>
      )}

      {hasRun && summary.overall && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t('market.average')} value={eur(summary.overall.average)} testId="market-average" />
          <Stat label={t('market.median')} value={eur(summary.overall.median)} testId="market-median" />
          <Stat label={t('market.range')} value={`${eur(summary.overall.min)} – ${eur(summary.overall.max)}`} />
          <Stat
            label={t('market.included')}
            value={`${summary.overall.count} / ${summary.groups.reduce((n, g) => n + g.matches.length, 0)}`}
            testId="market-count"
          />
        </div>
      )}
      {hasRun && !summary.overall && !running && <p className="text-sm text-muted-foreground">{t('market.noMatches')}</p>}

      {hasRun &&
        summary.groups.map((group) => (
          <SiteGroup
            key={group.site}
            group={group}
            status={status(group.site)}
            excluded={excluded}
            onToggle={onToggle}
          />
        ))}
    </Section>
  );
}

function SiteGroup({
  group,
  status,
  excluded,
  onToggle,
}: {
  group: MarketGroup;
  status: MarketSiteResult | undefined;
  excluded: ReadonlySet<string>;
  onToggle: (listingId: string, included: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const eur = (c: number | null | undefined) => formatMoney(c, 'EUR', lang);
  const [expanded, setExpanded] = useState(false);
  const listId = `market-listings-${group.site}`;

  return (
    <div className="grid gap-2" data-testid={`market-group-${group.site}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4>
          <SourceBadge source={group.site} />
        </h4>
        {group.summary && (
          <span className="text-sm tabular-nums" data-testid="market-group-average">
            {t('market.groupAverage', { average: eur(group.summary.average), count: group.summary.count })}
          </span>
        )}
      </div>
      <p className={cn('text-xs text-muted-foreground', status?.error && 'text-destructive')} data-testid="market-site-status">
        {status?.error
          ? `${t(`sourceErrors.${status.error.code}`)}: ${status.error.message}`
          : status?.checkedAt
            ? [
                t('market.checked', { count: status.found ?? 0, when: formatRelative(status.checkedAt, lang) }),
                group.hidden > 0 ? t('market.hidden', { count: group.hidden }) : null,
                status.removed ? t('market.removed', { count: status.removed }) : null,
                status.complete === false ? t('market.pageLimit', { pages: status.pagesScanned }) : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : t('market.notChecked')}
        {status?.searchUrl && (
          <>
            {' · '}
            <a href={status.searchUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              {t('market.openSearch')}
              <ExternalLink className="size-3" />
            </a>
          </>
        )}
      </p>
      {group.matches.length > 0 && (
        <Disclosure
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          aria-controls={listId}
          data-testid="market-listings-toggle"
        >
          {t('market.listings', { count: group.matches.length })}
        </Disclosure>
      )}
      {group.matches.length > 0 && expanded && (
        <ul id={listId} className="divide-y rounded-lg border" data-testid="market-listings">
          {group.matches.map(({ listing }) => (
            <ListingItem
              key={listing.id}
              listing={listing as StoredMarketListing}
              included={!excluded.has(listing.id)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ListingItem({
  listing,
  included,
  onToggle,
}: {
  listing: StoredMarketListing;
  included: boolean;
  onToggle: (listingId: string, included: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const eur = (c: number | null | undefined) => formatMoney(c, 'EUR', lang);
  const details = [
    listing.year,
    listing.mileageKm != null ? t('units.km', { value: formatNumber(listing.mileageKm, lang) }) : null,
    listing.fuel,
    listing.transmission,
    listing.location,
  ].filter(Boolean);

  return (
    <li className={cn('flex items-start gap-3 px-3 py-2', !included && 'opacity-50')} data-testid="market-listing">
      <Checkbox
        className="mt-1"
        checked={included}
        disabled={listing.priceEurCents == null}
        onCheckedChange={(v) => onToggle(listing.id, v === true)}
        aria-label={t('market.include', { title: listing.title, price: eur(listing.priceEurCents) })}
      />
      <PhotoThumb url={listing.imageUrl} href={listing.url} alt={listing.title} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold tabular-nums" data-testid="market-listing-price">
            {eur(listing.priceEurCents)}
          </span>
          {listing.previousPriceEurCents != null && (
            <span className="text-xs text-muted-foreground line-through tabular-nums" title={t('market.previousPrice')}>
              {eur(listing.previousPriceEurCents)}
            </span>
          )}
          <a
            href={listing.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate text-sm hover:underline"
          >
            {listing.title}
          </a>
          <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
        </div>
        {details.length > 0 && <div className="truncate text-xs text-muted-foreground">{details.join(' · ')}</div>}
      </div>
    </li>
  );
}
