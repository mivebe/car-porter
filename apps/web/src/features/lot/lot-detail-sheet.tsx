import type { Lot } from '@car-porter/core';
import { ExternalLink, ImageOff, Info, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { lotTitle } from '@/features/search/lot-title';
import { SourceBadge } from '@/features/search/source-badge';
import { formatDateTime, formatMoney, formatNumber, sentenceCase } from '@/lib/format';
import { CostSection } from './cost-section';
import { useFx, useLot, useLotInputs, useSettings, useUpdateLotInputs } from './hooks';
import { MoneyInput } from './money-input';
import { Section } from './section';
import { VinField } from './vin-field';

interface LotDetailSheetProps {
  lotId: string | null;
  onClose: () => void;
}

export function LotDetailSheet({ lotId, onClose }: LotDetailSheetProps) {
  return (
    <Sheet open={!!lotId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {lotId && <LotDetail lotId={lotId} />}
      </SheetContent>
    </Sheet>
  );
}

function LotDetail({ lotId }: { lotId: string }) {
  const { t, i18n } = useTranslation();
  const lot = useLot(lotId);
  const inputs = useLotInputs(lotId);
  const settings = useSettings();
  const fx = useFx();
  const updateInputs = useUpdateLotInputs(lotId);

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
  return (
    <>
      <SheetHeader className="gap-2 border-b p-6 pr-12">
        <SheetTitle className="text-xl">{lotTitle(data)}</SheetTitle>
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

      <div className="grid gap-6 p-6">
        <Photos lot={data} />
        <Facts lot={data} />
        <Separator />
        <div className="grid gap-4 sm:grid-cols-2">
          <VinField
            lotVin={data.vin}
            override={inputs.data.vinOverride}
            onCommit={(vinOverride) => updateInputs.mutate({ vinOverride })}
          />
          <div className="grid content-start gap-2">
            <Label htmlFor="repair-estimate" className="flex items-center gap-2">
              <Wrench className="size-4" />
              {t('lotDetail.repairEstimate')}
            </Label>
            <MoneyInput
              id="repair-estimate"
              currency="EUR"
              valueCents={inputs.data.repairEstimateEurCents}
              onCommit={(cents) => updateInputs.mutate({ repairEstimateEurCents: cents ?? 0 })}
            />
            <p className="text-xs text-muted-foreground">{t('lotDetail.repairHint')}</p>
          </div>
        </div>
        <Separator />
        <CostSection
          lot={data}
          inputs={inputs.data}
          settings={settings.data}
          fx={fx.data}
          fxError={fx.isError}
          estimateUsdCents={null}
          onChange={(patch) => updateInputs.mutate(patch)}
        />
      </div>
    </>
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
    ['odometer', lot.odometerMiles != null ? `${formatNumber(lot.odometerMiles, lang)} mi` : null],
    ['engine', lot.engine],
    ['fuel', sentenceCase(lot.fuel)],
    ['transmission', sentenceCase(lot.transmission)],
    ['drive', sentenceCase(lot.drive)],
    ['primaryDamage', sentenceCase(lot.primaryDamage)],
    ['secondaryDamage', sentenceCase(lot.secondaryDamage)],
    ['titleType', sentenceCase(lot.titleType)],
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
