import type { Lot } from '@car-porter/core';
import { BookmarkCheck, ImageOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { VerdictBadge } from '@/features/lot/verdict-section';
import type { LotInsights } from '@/lib/api';
import { formatDateTime, formatMoney, formatNumber, sentenceCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import { INSIGHT_COLUMNS, type LotColumnId } from './lot-columns';
import type { LotMarks } from './lot-marks-hooks';
import { lotTitle } from './lot-title';
import { SourceBadge } from './source-badge';

interface LotResultsProps {
  lots: Lot[];
  /** Visible columns in display order. */
  columns: LotColumnId[];
  /** Keyed by lot id; a lot missing from it is still loading. */
  insights: Map<string, LotInsights>;
  marks: LotMarks;
  selectedId: string | null;
  onSelect: (lot: Lot) => void;
}

export function Thumbnail({ lot }: { lot: Lot }) {
  const src = lot.imageUrls.at(-1) ?? lot.imageUrls[0];
  return (
    <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {src ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
      ) : (
        <ImageOff className="size-4 text-muted-foreground" />
      )}
    </div>
  );
}

const alignRight = (id: LotColumnId) => INSIGHT_COLUMNS.has(id) || id === 'price';

export function LotResults({ lots, columns, insights, marks, selectedId, onSelect }: LotResultsProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const money = (cents: number | null | undefined, currency: 'USD' | 'EUR') => formatMoney(cents, currency, lang);
  const stacked = (main: ReactNode, sub?: ReactNode, muted = false) => (
    <div className={cn('flex flex-col items-end', muted && 'text-muted-foreground')}>
      <span className="tabular-nums">{main}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );

  const cell = (id: LotColumnId, lot: Lot, info: LotInsights | undefined): ReactNode => {
    const tracked = marks.tracked.has(lot.id);
    if (INSIGHT_COLUMNS.has(id) && !info) return <Skeleton className="ml-auto h-4 w-14" />;
    switch (id) {
      case 'photo':
        return <Thumbnail lot={lot} />;
      case 'vehicle':
        return (
          <div className="flex flex-col gap-1">
            {/* dimmed once opened, like a visited link */}
            <span className={cn('font-medium', marks.opened.has(lot.id) && 'text-muted-foreground')}>{lotTitle(lot)}</span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {tracked && <BookmarkCheck aria-label={t('tracking.tracked')} className="size-3.5 text-primary" />}
              <SourceBadge source={lot.source} />
              <span className="tabular-nums">#{lot.lotNumber}</span>
              {lot.vin && <span className="font-mono">{lot.vin}</span>}
            </span>
          </div>
        );
      case 'odometer':
        return lot.odometerMiles != null ? t('units.miles', { value: formatNumber(lot.odometerMiles, lang) }) : '-';
      case 'damage':
        return (
          <div className="flex flex-col text-sm">
            <span>{sentenceCase(lot.primaryDamage) || '-'}</span>
            {lot.titleType && <span className="text-xs text-muted-foreground">{sentenceCase(lot.titleType)}</span>}
          </div>
        );
      case 'location':
        return lot.location ?? '-';
      case 'saleDate':
        return formatDateTime(lot.saleDate, lang);
      case 'price':
        if (lot.currentBidUsdCents != null)
          return stacked(
            <span className="font-medium">{money(lot.currentBidUsdCents, 'USD')}</span>,
            t('lot.currentBid'),
          );
        if (lot.buyNowUsdCents != null)
          return stacked(<span className="font-medium">{money(lot.buyNowUsdCents, 'USD')}</span>, t('lot.buyNow'));
        if (lot.acvUsdCents != null) return stacked(money(lot.acvUsdCents, 'USD'), t('lot.acv'), true);
        return <span className="text-muted-foreground">-</span>;
      case 'history':
        return stacked(info!.historyCount ?? '-');
      case 'sales':
        return stacked(info!.estimate?.count ?? '-');
      case 'avgSold':
        return stacked(money(info!.estimate?.average, 'USD'));
      case 'costBg': {
        const { cost, bidUsdCents, bidSource } = info!.evaluation;
        return stacked(
          money(cost?.totalEurCents, 'EUR'),
          bidUsdCents != null &&
            t('tracking.bid', {
              amount: money(bidUsdCents, 'USD'),
              source: t(`tracking.bidSource.${bidSource}`),
            }),
        );
      }
      case 'market':
        return stacked(
          money(info!.market?.average, 'EUR'),
          info!.market && t('tracking.listings', { count: info!.market.count }),
        );
      case 'margin': {
        const margin = info!.evaluation.verdict.marginEurCents;
        return (
          <span className={cn('font-semibold tabular-nums', (margin ?? 0) < 0 && 'text-destructive')}>
            {money(margin, 'EUR')}
          </span>
        );
      }
      case 'verdict':
        return <VerdictBadge status={info!.evaluation.verdict.status} />;
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {columns.map((id) => (
              <TableHead key={id} className={cn(id === 'photo' && 'w-24', alignRight(id) && 'text-right')}>
                {id !== 'photo' && t(`search.columns.${id}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lots.map((lot) => (
            <TableRow
              key={lot.id}
              data-testid="lot-row"
              data-state={selectedId === lot.id ? 'selected' : undefined}
              data-tracked={marks.tracked.has(lot.id) || undefined}
              data-opened={marks.opened.has(lot.id) || undefined}
              className={cn(
                'cursor-pointer',
                // tracked: a faint brand tint and a bar on the leading edge
                'data-tracked:bg-primary/6 data-tracked:hover:bg-primary/10 data-tracked:[&>td:first-child]:shadow-[inset_3px_0_0_var(--primary)]',
              )}
              tabIndex={0}
              onClick={() => onSelect(lot)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(lot);
                }
              }}
            >
              {columns.map((id) => (
                <TableCell
                  key={id}
                  data-column={id}
                  className={cn(
                    id !== 'vehicle' && id !== 'damage' && id !== 'location' && 'whitespace-nowrap',
                    (id === 'location' || id === 'saleDate') && 'text-sm',
                    id === 'odometer' && 'tabular-nums',
                    alignRight(id) && 'text-right',
                  )}
                >
                  {cell(id, lot, insights.get(lot.id))}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
