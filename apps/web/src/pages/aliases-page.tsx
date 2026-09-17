import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AliasBoard } from '@/features/aliases/alias-board';
import { useAliasMakes, useAliasSummary } from '@/features/aliases/alias-hooks';
import { ScanButton } from '@/features/aliases/scan-button';
import { Combobox } from '@/features/search/combobox';
import type { AliasKind, AliasStatus } from '@/lib/api';

const STATUSES: AliasStatus[] = ['unassigned', 'auto', 'non_car', 'manual', 'ignored'];
const ALL = 'all';

export function AliasesPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const kind: AliasKind = params.get('kind') === 'model' ? 'model' : 'make';
  const statusParam = params.get('status');
  const status = statusParam === ALL ? undefined : (STATUSES.find((s) => s === statusParam) ?? 'unassigned');
  const source = (['copart', 'iaai'] as const).find((s) => s === params.get('source'));
  const make = kind === 'model' ? (params.get('make') ?? '') : '';
  const q = params.get('q') ?? '';
  const active = params.get('sel');

  const update = (patch: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const summary = useAliasSummary();
  const aliasMakes = useAliasMakes();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('pages.aliases.title')} />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={kind} onValueChange={(v) => update({ kind: v === 'model' ? 'model' : null, make: null, sel: null })}>
          <TabsList>
            {(['make', 'model'] as const).map((k) => (
              <TabsTrigger key={k} value={k} className="gap-1.5">
                {t(`aliases.kind.${k}`)}
                {!!summary.data?.unassigned[k] && (
                  <Badge variant="destructive" className="h-4 px-1.5 text-[10px] tabular-nums" data-testid={`unassigned-${k}`}>
                    {summary.data.unassigned[k]}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Select value={status ?? ALL} onValueChange={(v) => update({ status: v === 'unassigned' ? null : v })}>
          <SelectTrigger className="w-44" aria-label={t('aliases.filters.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`aliases.status.${s}`)}
              </SelectItem>
            ))}
            <SelectItem value={ALL}>{t('aliases.filters.allStatuses')}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={source ?? ALL} onValueChange={(v) => update({ source: v === ALL ? null : v })}>
          <SelectTrigger className="w-36" aria-label={t('aliases.filters.site')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('aliases.filters.allSites')}</SelectItem>
            <SelectItem value="copart">{t('sources.copart')}</SelectItem>
            <SelectItem value="iaai">{t('sources.iaai')}</SelectItem>
          </SelectContent>
        </Select>

        {kind === 'model' && (
          <div className="flex items-center gap-1">
            <div className="w-56">
              <Combobox
                ariaLabel={t('aliases.filters.make')}
                value={make}
                onChange={(m) => update({ make: m, sel: null })}
                options={(aliasMakes.data?.items ?? []).map((m) => m.name)}
                loading={aliasMakes.isLoading}
                placeholder={t('aliases.filters.allMakes')}
                searchPlaceholder={t('search.searchMake')}
                emptyText={t('search.noOptions')}
              />
            </div>
            {make && (
              <Button variant="ghost" size="sm" onClick={() => update({ make: null, sel: null })}>
                {t('aliases.filters.allMakes')}
              </Button>
            )}
          </div>
        )}

        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            key={`${kind}|${make}`}
            className="pl-8"
            placeholder={t('aliases.filters.search')}
            aria-label={t('aliases.filters.search')}
            defaultValue={q}
            onChange={(e) => update({ q: e.target.value.trim() || null })}
          />
        </div>
        <ScanButton />
      </div>

      <AliasBoard
        // a new make/model list starts with a fresh search and no locally created names
        key={`${kind}|${make}`}
        kind={kind}
        make={make}
        source={source}
        status={status}
        q={q}
        active={active}
        onActiveChange={(name) => update({ sel: name })}
        onMakeChange={(m) => update({ make: m, sel: null })}
      />
    </div>
  );
}
