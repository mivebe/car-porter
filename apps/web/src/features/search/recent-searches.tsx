import { DEFAULT_IAAI_MARKETS, IAAI_MARKETS } from '@car-porter/core';
import { History, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { LotSearchParams } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useRecentSearches } from './recent-search-hooks';

interface RecentSearchesProps {
  onSearch: (params: LotSearchParams) => void;
}

export function RecentSearches({ onSearch }: RecentSearchesProps) {
  const { t, i18n } = useTranslation();
  const { list, remove, clear } = useRecentSearches();
  const items = list.data?.items ?? [];

  const details = (f: LotSearchParams) =>
    [
      f.trim,
      f.bodyStyle && t(`bodyStyles.${f.bodyStyle}`, { defaultValue: f.bodyStyle }),
      f.transmission && t(`search.transmissions.${f.transmission}`),
      f.engine && `${f.engine} L`,
      // US only is the default and goes unmentioned
      f.iaaiMarkets?.length &&
        f.iaaiMarkets.join(',') !== DEFAULT_IAAI_MARKETS.join(',') &&
        (f.iaaiMarkets.length === IAAI_MARKETS.length
          ? t('search.allMarkets')
          : f.iaaiMarkets.map((m) => t(`search.markets.${m}`)).join(', ')),
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={items.length === 0}>
          <History />
          {t('search.recent.title')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {items.map((s) => (
          <div key={s.key} className="flex items-center gap-1">
            <DropdownMenuItem className="min-w-0 flex-1 flex-col items-start gap-0.5" onSelect={() => onSearch(s.filters)}>
              <span className="flex w-full items-baseline justify-between gap-2">
                <span className="truncate font-medium">
                  {s.filters.make} {s.filters.model}{' '}
                  {s.filters.yearFrom === s.filters.yearTo
                    ? s.filters.yearFrom
                    : `${s.filters.yearFrom}–${s.filters.yearTo}`}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(s.searchedAt, i18n.language)}</span>
              </span>
              {details(s.filters) && (
                <span className="w-full truncate text-xs text-muted-foreground">{details(s.filters)}</span>
              )}
            </DropdownMenuItem>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={t('search.recent.remove')}
              onClick={() => remove.mutate(s.key)}
            >
              <X />
            </Button>
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-muted-foreground" onSelect={() => clear.mutate()}>
          {t('search.recent.clear')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
