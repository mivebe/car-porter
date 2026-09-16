import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ListChecks, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LotDetailSheet } from '@/features/lot/lot-detail-sheet';
import { VerdictBadge } from '@/features/lot/verdict-section';
import { Thumbnail } from '@/features/search/lot-results';
import { lotTitle } from '@/features/search/lot-title';
import { SourceBadge } from '@/features/search/source-badge';
import {
  TRACKED_KEY,
  useTrackedLots,
  type TrackedLotRow,
} from '@/features/tracking/tracking-hooks';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

export function TrackingPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedLotId = searchParams.get('lot');
  const tracked = useTrackedLots();

  const setSelectedLot = (id: string | null) => setSearchParams(id ? { lot: id } : {});
  const remove = async (lotId: string) => {
    await api.untrack(lotId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: TRACKED_KEY }),
      queryClient.invalidateQueries({ queryKey: ['lot', lotId] }),
    ]);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('pages.tracking.title')} description={t('pages.tracking.description')} />

      {tracked.isPending && (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}
      {tracked.isError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
        >
          {t('tracking.requestFailed')}
        </div>
      )}
      {tracked.data?.lots.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <ListChecks className="size-10" />
          <p className="max-w-md text-sm">{t('tracking.empty')}</p>
        </div>
      )}
      {tracked.data && tracked.data.lots.length > 0 && (
        <TrackedTable
          rows={tracked.data.lots}
          selectedId={selectedLotId}
          onSelect={setSelectedLot}
          onRemove={remove}
        />
      )}

      <LotDetailSheet
        lotId={selectedLotId}
        onClose={() => {
          setSelectedLot(null);
          // inputs, exclusions and scans may have changed in the sheet
          void queryClient.invalidateQueries({ queryKey: TRACKED_KEY });
        }}
      />
    </div>
  );
}

function TrackedTable({
  rows,
  selectedId,
  onSelect,
  onRemove,
}: {
  rows: TrackedLotRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const muted = (text: string) => <span className="text-xs text-muted-foreground">{text}</span>;

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="hidden w-24 sm:table-cell" />
            <TableHead>{t('lot.vehicle')}</TableHead>
            <TableHead className="hidden text-right md:table-cell">
              {t('tracking.columns.estimate')}
            </TableHead>
            <TableHead className="hidden text-right md:table-cell">
              {t('tracking.columns.cost')}
            </TableHead>
            <TableHead className="hidden text-right lg:table-cell">
              {t('tracking.columns.market')}
            </TableHead>
            <TableHead className="text-right">{t('tracking.columns.margin')}</TableHead>
            <TableHead>{t('tracking.columns.verdict')}</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ lot, estimate, market, evaluation }) => (
            <TableRow
              key={lot.id}
              data-testid="tracked-row"
              data-state={selectedId === lot.id ? 'selected' : undefined}
              className="cursor-pointer"
              tabIndex={0}
              onClick={() => onSelect(lot.id)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onSelect(lot.id);
                }
              }}
            >
              <TableCell className="hidden sm:table-cell">
                <Thumbnail lot={lot} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{lotTitle(lot)}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <SourceBadge source={lot.source} />
                    <span className="tabular-nums">#{lot.lotNumber}</span>
                    <span>{formatDateTime(lot.saleDate, lang)}</span>
                  </span>
                </div>
              </TableCell>
              <TableCell
                className="hidden text-right whitespace-nowrap md:table-cell"
                data-testid="tracked-estimate"
              >
                <div className="flex flex-col items-end">
                  <span className="tabular-nums">
                    {formatMoney(estimate?.average, 'USD', lang)}
                  </span>
                  {estimate && muted(t('tracking.sales', { count: estimate.count }))}
                </div>
              </TableCell>
              <TableCell
                className="hidden text-right whitespace-nowrap md:table-cell"
                data-testid="tracked-cost"
              >
                <div className="flex flex-col items-end">
                  <span className="tabular-nums">
                    {formatMoney(evaluation.cost?.totalEurCents, 'EUR', lang)}
                  </span>
                  {evaluation.bidUsdCents != null &&
                    muted(
                      t('tracking.bid', {
                        amount: formatMoney(evaluation.bidUsdCents, 'USD', lang),
                        source: t(`tracking.bidSource.${evaluation.bidSource}`),
                      }),
                    )}
                </div>
              </TableCell>
              <TableCell
                className="hidden text-right whitespace-nowrap lg:table-cell"
                data-testid="tracked-market"
              >
                <div className="flex flex-col items-end">
                  <span className="tabular-nums">{formatMoney(market?.average, 'EUR', lang)}</span>
                  {market && muted(t('tracking.listings', { count: market.count }))}
                </div>
              </TableCell>
              <TableCell
                className={cn(
                  'text-right font-semibold whitespace-nowrap tabular-nums',
                  (evaluation.verdict.marginEurCents ?? 0) < 0 && 'text-destructive',
                )}
                data-testid="tracked-margin"
              >
                {formatMoney(evaluation.verdict.marginEurCents, 'EUR', lang)}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <VerdictBadge status={evaluation.verdict.status} className="text-sm" />
              </TableCell>
              <TableCell
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <div className="flex justify-end gap-1">
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    aria-label={t('lotDetail.openOn', { source: t(`sources.${lot.source}`) })}
                  >
                    <a href={lot.url} target="_blank" rel="noreferrer">
                      <ExternalLink />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('tracking.remove', { title: lotTitle(lot) })}
                    onClick={() => void onRemove(lot.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
