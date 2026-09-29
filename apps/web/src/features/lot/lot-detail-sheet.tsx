import { effectiveMarketSources, evaluateLot, summarizeMarket, type Lot } from '@car-porter/core';
import { Bookmark, BookmarkCheck, ExternalLink, ImageOff, Info } from 'lucide-react';
import { Fragment, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useMarkOpened } from '@/features/search/lot-marks-hooks';
import { lotTitle } from '@/features/search/lot-title';
import { SourceBadge } from '@/features/search/source-badge';
import { useSetTracked } from '@/features/tracking/tracking-hooks';
import { formatDateTime, formatMoney, formatNumber, milesToKm, sentenceCase } from '@/lib/format';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import { CostSection } from './cost-section';
import { estimateSummary, useEstimate, useRunEstimate, useToggleEstimateRecord } from './estimate-hooks';
import { EstimateSection } from './estimate-section';
import { useHistory, useRunHistory } from './history-hooks';
import { HistorySection } from './history-section';
import { useMarket, useRunMarket, useToggleMarketListing } from './market-hooks';
import { MarketSection } from './market-section';
import { useFx, useLot, useLotInputs, useSettings, useUpdateLotInputs } from './hooks';
import { MoneyInput } from './money-input';
import { Section } from './section';
import { VerdictSection } from './verdict-section';
import { VinField } from './vin-field';

interface LotDetailSheetProps {
  lotId: string | null;
  onClose: () => void;
}

/** Desktop widths get a large centred modal; narrower screens keep the side sheet. */
const DESKTOP = '(min-width: 64rem)';
/** Wide enough to put the car and the numbers side by side. */
const WIDE = '(min-width: 80rem)';

export function LotDetailSheet({ lotId, onClose }: LotDetailSheetProps) {
  const desktop = useMediaQuery(DESKTOP);
  const wide = useMediaQuery(WIDE);
  const onOpenChange = (open: boolean) => !open && onClose();
  const body = lotId && <LotDetail lotId={lotId} columns={wide ? 2 : 1} />;

  if (desktop) {
    return (
      <Dialog open={!!lotId} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(min(100vw,96rem)-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={!!lotId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-hidden p-0 sm:max-w-2xl">{body}</SheetContent>
    </Sheet>
  );
}

function LotDetail({ lotId, columns }: { lotId: string; columns: 1 | 2 }) {
  const { t, i18n } = useTranslation();
  const { mutate: markOpened } = useMarkOpened();
  useEffect(() => markOpened(lotId), [lotId, markOpened]);
  const lot = useLot(lotId);
  const inputs = useLotInputs(lotId);
  const settings = useSettings();
  const fx = useFx();
  const updateInputs = useUpdateLotInputs(lotId);
  const estimate = useEstimate(lotId);
  const runEstimate = useRunEstimate(lotId);
  const toggleEstimate = useToggleEstimateRecord(lotId);
  const history = useHistory(lotId);
  const runHistory = useRunHistory(lotId);
  const market = useMarket(lotId);
  const runMarket = useRunMarket(lotId);
  const toggleMarket = useToggleMarketListing(lotId);
  const setTracked = useSetTracked(lotId);

  if (lot.isError) {
    return (
      <SheetHeader className="p-6">
        <SheetTitle>{t('lotDetail.notFound')}</SheetTitle>
        <SheetDescription>{lotId}</SheetDescription>
      </SheetHeader>
    );
  }

  if (!lot.data || !inputs.data || !settings.data) {
    return (
      <div className="grid gap-4 p-6" aria-busy="true">
        <SheetTitle className="sr-only">{t('lotDetail.loading')}</SheetTitle>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const data = lot.data.lot;
  const tracked = setTracked.isPending ? setTracked.variables : !!lot.data.trackedAt;
  const marketSites = effectiveMarketSources(inputs.data.marketSources, settings.data.market.enabledSources);
  const marketSummary = summarizeMarket(data, market.data?.listings ?? [], {
    sites: marketSites,
    toggles: inputs.data.marketMatch,
    mileageRangeKm: settings.data.market.mileageRangeKm,
    excludedIds: new Set(market.data?.excludedIds ?? []),
  });
  const evaluation = evaluateLot({
    lot: data,
    inputs: inputs.data,
    settings: settings.data,
    usdToEur: fx.data?.usdToEur ?? null,
    estimateUsdCents: estimateSummary(estimate.data)?.average ?? null,
    marketAverageEurCents: marketSummary.overall?.average ?? null,
  });

  const photos = (
    <>
      <Photos lot={data} />
      <Facts lot={data} />
    </>
  );
  const vehicleInputs = (
    <div className="grid gap-4 sm:grid-cols-2">
      <VinField
        lotVin={data.vin}
        override={inputs.data.vinOverride}
        onCommit={(vinOverride) => updateInputs.mutate({ vinOverride })}
      />
      <div className="grid content-start gap-1.5">
        <Label htmlFor="repair-estimate">{t('lotDetail.repairEstimate')}</Label>
        <MoneyInput
          id="repair-estimate"
          currency="EUR"
          valueCents={inputs.data.repairEstimateEurCents}
          onCommit={(cents) => updateInputs.mutate({ repairEstimateEurCents: cents ?? 0 })}
        />
      </div>
    </div>
  );
  const estimateSection = (
    <EstimateSection
      data={estimate.data}
      running={runEstimate.isPending}
      runFailed={runEstimate.isError}
      onRun={(refresh) => runEstimate.mutate(refresh)}
      onToggle={(recordId, included) => toggleEstimate.mutate({ recordId, included })}
    />
  );
  const historySection = (
    <HistorySection
      lot={data}
      data={history.data}
      running={runHistory.isPending}
      runFailed={runHistory.isError}
      onRun={(refresh) => runHistory.mutate(refresh)}
    />
  );
  const costSection = (
    <CostSection
      inputs={inputs.data}
      settings={settings.data}
      fx={fx.data}
      fxError={fx.isError}
      evaluation={evaluation}
      onChange={(patch) => updateInputs.mutate(patch)}
    />
  );
  const marketSection = (
    <MarketSection
      lot={data}
      inputs={inputs.data}
      settings={settings.data}
      data={market.data}
      sites={marketSites}
      summary={marketSummary}
      running={runMarket.isPending}
      runFailed={runMarket.isError}
      onRun={(refresh) => runMarket.mutate(refresh)}
      onToggle={(listingId, included) => toggleMarket.mutate({ listingId, included })}
      onChange={(patch) => updateInputs.mutate(patch)}
    />
  );
  const verdictSection = <VerdictSection evaluation={evaluation} />;

  return (
    <>
      <SheetHeader className="shrink-0 gap-2 border-b p-6 pr-12">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <SheetTitle className="text-xl">{lotTitle(data)}</SheetTitle>
          <Button
            size="sm"
            variant={tracked ? 'secondary' : 'outline'}
            aria-pressed={tracked}
            disabled={setTracked.isPending}
            onClick={() => setTracked.mutate(!tracked)}
          >
            {tracked ? <BookmarkCheck /> : <Bookmark />}
            {tracked ? t('tracking.tracked') : t('tracking.track')}
          </Button>
        </div>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <SourceBadge source={data.source} />
            <span className="tabular-nums">#{data.lotNumber}</span>
            <span>·</span>
            <span>{data.saleDate ? formatDateTime(data.saleDate, i18n.language) : t('lotDetail.noSaleDate')}</span>
            <Button asChild variant="link" size="sm" className="h-auto px-0">
              <a href={data.url} target="_blank" rel="noreferrer">
                {t('lotDetail.openOn', { source: t(`sources.${data.source}`) })}
                <ExternalLink />
              </a>
            </Button>
          </div>
        </SheetDescription>
      </SheetHeader>

      {/* only the body scrolls: the header and the close button stay in view */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="lot-detail-body">
        {columns === 2 ? (
          <div className="grid grid-cols-2 gap-8 p-6" data-testid="lot-detail-columns">
            <Stack>
              {photos}
              {vehicleInputs}
              {estimateSection}
              {historySection}
            </Stack>
            <Stack className="border-l pl-8">
              {verdictSection}
              {costSection}
              {marketSection}
            </Stack>
          </div>
        ) : (
          <Stack className="p-6">
            {photos}
            {vehicleInputs}
            {estimateSection}
            {historySection}
            {costSection}
            {marketSection}
            {verdictSection}
          </Stack>
        )}
      </div>
    </>
  );
}

/** Blocks one under another with a separator between them. */
function Stack({ children, className }: { children: ReactNode[]; className?: string }) {
  return (
    <div className={cn('grid min-w-0 content-start gap-6', className)}>
      {children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <Separator />}
          {child}
        </Fragment>
      ))}
    </div>
  );
}

function Photos({ lot }: { lot: Lot }) {
  const { t } = useTranslation();
  const photo = lot.imageUrls[0];
  if (!photo) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 rounded-lg bg-muted text-sm text-muted-foreground">
        <ImageOff className="size-4" />
        {t('lotDetail.noPhotos')}
      </div>
    );
  }
  return (
    <a href={lot.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-muted">
      <img src={photo} alt={lotTitle(lot)} referrerPolicy="no-referrer" className="max-h-80 w-full object-cover" />
    </a>
  );
}

function Facts({ lot }: { lot: Lot }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const facts: [string, string | null][] = [
    ['vin', lot.vin],
    ['odometer', lot.odometerMiles != null ? t('units.km', { value: formatNumber(milesToKm(lot.odometerMiles), lang) }) : null],
    ['engine', lot.engine],
    ['fuel', sentenceCase(lot.fuel)],
    ['transmission', sentenceCase(lot.transmission)],
    ['drive', sentenceCase(lot.drive)],
    ['primaryDamage', sentenceCase(lot.primaryDamage)],
    ['secondaryDamage', sentenceCase(lot.secondaryDamage)],
    ['titleType', sentenceCase(lot.titleType)],
    ['condition', lot.condition ? t(`search.conditions.${lot.condition}`) : null],
    ['keys', lot.keys == null ? null : t(lot.keys ? 'lotDetail.facts.keysYes' : 'lotDetail.facts.keysNo')],
    ['location', lot.location],
    ['currentBid', lot.currentBidUsdCents != null ? formatMoney(lot.currentBidUsdCents, 'USD', lang) : null],
    ['buyNow', lot.buyNowUsdCents != null ? formatMoney(lot.buyNowUsdCents, 'USD', lang) : null],
    ['acv', lot.acvUsdCents != null ? formatMoney(lot.acvUsdCents, 'USD', lang) : null],
  ];
  return (
    <Section icon={Info} title={t('lotDetail.details')}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        {facts
          .filter(([, value]) => value)
          .map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t(`lotDetail.facts.${key}`)}</dt>
              <dd className={key === 'vin' ? 'truncate font-mono' : 'truncate'}>{value}</dd>
            </div>
          ))}
      </dl>
    </Section>
  );
}
