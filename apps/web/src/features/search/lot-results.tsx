import type { Lot } from '@car-porter/core';
import { ImageOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatMoney, formatNumber, sentenceCase } from '@/lib/format';
import { lotTitle } from './lot-title';
import { SourceBadge } from './source-badge';

interface LotResultsProps {
  lots: Lot[];
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

export function LotResults({ lots, selectedId, onSelect }: LotResultsProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-24" />
            <TableHead>{t('lot.vehicle')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('lot.odometer')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('lot.damage')}</TableHead>
            <TableHead className="hidden xl:table-cell">{t('lot.location')}</TableHead>
            <TableHead className="hidden sm:table-cell">{t('lot.saleDate')}</TableHead>
            <TableHead className="text-right">{t('lot.price')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lots.map((lot) => (
            <TableRow
              key={lot.id}
              data-testid="lot-row"
              data-state={selectedId === lot.id ? 'selected' : undefined}
              className="cursor-pointer"
              tabIndex={0}
              onClick={() => onSelect(lot)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(lot);
                }
              }}
            >
              <TableCell>
                <Thumbnail lot={lot} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{lotTitle(lot)}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <SourceBadge source={lot.source} />
                    <span className="tabular-nums">#{lot.lotNumber}</span>
                    {lot.vin && <span className="font-mono">{lot.vin}</span>}
                  </span>
                </div>
              </TableCell>
              <TableCell className="hidden tabular-nums lg:table-cell">
                {lot.odometerMiles != null ? `${formatNumber(lot.odometerMiles, lang)} mi` : '—'}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <div className="flex flex-col text-sm">
                  <span>{sentenceCase(lot.primaryDamage) || '—'}</span>
                  {lot.titleType && <span className="text-xs text-muted-foreground">{sentenceCase(lot.titleType)}</span>}
                </div>
              </TableCell>
              <TableCell className="hidden text-sm xl:table-cell">{lot.location ?? '—'}</TableCell>
              <TableCell className="hidden text-sm whitespace-nowrap sm:table-cell">{formatDateTime(lot.saleDate, lang)}</TableCell>
              <TableCell className="text-right whitespace-nowrap">
                {lot.currentBidUsdCents != null ? (
                  <div className="flex flex-col items-end">
                    <span className="font-medium tabular-nums">{formatMoney(lot.currentBidUsdCents, 'USD', lang)}</span>
                    <span className="text-xs text-muted-foreground">{t('lot.currentBid')}</span>
                  </div>
                ) : lot.buyNowUsdCents != null ? (
                  <div className="flex flex-col items-end">
                    <span className="font-medium tabular-nums">{formatMoney(lot.buyNowUsdCents, 'USD', lang)}</span>
                    <span className="text-xs text-muted-foreground">{t('lot.buyNow')}</span>
                  </div>
                ) : lot.acvUsdCents != null ? (
                  <div className="flex flex-col items-end text-muted-foreground">
                    <span className="tabular-nums">{formatMoney(lot.acvUsdCents, 'USD', lang)}</span>
                    <span className="text-xs">{t('lot.acv')}</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
