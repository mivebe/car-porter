import { DEFAULT_IAAI_MARKETS, IAAI_MARKETS, TRANSMISSIONS, type IaaiMarket, type Transmission } from '@car-porter/core';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCanonicalItems } from '@/features/aliases/alias-hooks';
import { api, type LotSearchParams } from '@/lib/api';
import { validateFilters, type FilterDraft, type FilterErrors } from './validate-filters';
import { Combobox } from './combobox';
import { YearPicker } from './year-picker';

/** Select value for "no filter" (Radix selects can't hold an empty value). */
const ANY = 'any';

interface SearchFiltersProps {
  initial: Partial<LotSearchParams>;
  onSearch: (params: LotSearchParams) => void;
  searching: boolean;
}

export function SearchFilters({ initial, onSearch, searching }: SearchFiltersProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<FilterDraft>({
    make: initial.make ?? '',
    model: initial.model ?? '',
    yearFrom: initial.yearFrom ? String(initial.yearFrom) : '',
    yearTo: initial.yearTo ? String(initial.yearTo) : '',
    trim: initial.trim ?? '',
    iaaiMarkets: initial.iaaiMarkets?.length ? initial.iaaiMarkets : DEFAULT_IAAI_MARKETS,
    bodyStyle: initial.bodyStyle ?? '',
    transmission: initial.transmission ?? '',
    engine: initial.engine ?? '',
  });
  const [errors, setErrors] = useState<FilterErrors>({});

  const makes = useQuery({ queryKey: ['catalog', 'makes'], queryFn: api.makes, staleTime: Infinity });
  const models = useQuery({
    queryKey: ['catalog', 'models', draft.make.toLowerCase()],
    queryFn: () => api.models(draft.make),
    enabled: !!draft.make,
    staleTime: Infinity,
  });
  const bodyStyles = useCanonicalItems({ kind: 'body' });
  const bodyOptions = [...new Set([...(bodyStyles.data?.items ?? []).map((b) => b.name), draft.bodyStyle].filter(Boolean))];

  const update = (patch: Partial<FilterDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(patch) as (keyof FilterErrors)[]) delete next[key];
      return next;
    });
  };

  /** Unticking the last market is ignored. */
  const toggleMarket = (market: IaaiMarket) => {
    const current = draft.iaaiMarkets;
    const next = current.includes(market) ? current.filter((m) => m !== market) : [...current, market];
    if (next.length === 0) return;
    update({ iaaiMarkets: IAAI_MARKETS.filter((m) => next.includes(m)) });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateFilters(draft);
    if ('errors' in result) setErrors(result.errors);
    else onSearch(result.params);
  };

  const fieldError = (key: keyof FilterErrors) =>
    errors[key] && (
      <p role="alert" className="text-xs text-destructive">
        {t(errors[key]!)}
      </p>
    );

  return (
    <Card className="py-4">
      <CardContent>
        <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-3 md:items-start lg:grid-cols-[1.2fr_1.2fr_0.9fr_0.6fr_0.6fr_auto]">
          <div className="grid gap-1.5">
            <Label htmlFor="filter-make">{t('search.make')}</Label>
            <Combobox
              id="filter-make"
              ariaLabel={t('search.make')}
              value={draft.make}
              onChange={(make) => update({ make, model: make === draft.make ? draft.model : '' })}
              options={(makes.data?.items ?? []).map((m) => m.name)}
              loading={makes.isLoading}
              placeholder={t('search.selectMake')}
              searchPlaceholder={t('search.searchMake')}
              emptyText={t('search.noOptions')}
              customOptionLabel={(typed) => t('search.useCustom', { value: typed })}
            />
            {fieldError('make')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-model">{t('search.model')}</Label>
            <Combobox
              id="filter-model"
              ariaLabel={t('search.model')}
              value={draft.model}
              onChange={(model) => update({ model })}
              options={(models.data?.items ?? []).map((m) => m.name)}
              loading={models.isFetching}
              disabled={!draft.make}
              placeholder={draft.make ? t('search.selectModel') : t('search.selectMakeFirst')}
              searchPlaceholder={t('search.searchModel')}
              emptyText={t('search.noOptions')}
              customOptionLabel={(typed) => t('search.useCustom', { value: typed })}
            />
            {fieldError('model')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-trim">{t('search.trim')}</Label>
            <Input
              id="filter-trim"
              value={draft.trim}
              maxLength={40}
              placeholder={t('search.trimPlaceholder')}
              onChange={(e) => update({ trim: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-year-from">{t('search.yearFrom')}</Label>
            <YearPicker
              id="filter-year-from"
              ariaLabel={t('search.yearFrom')}
              placeholder="2018"
              value={draft.yearFrom}
              invalid={!!errors.yearFrom}
              onChange={(yearFrom) =>
                // keep the range valid: "to" follows "from" when it would end up earlier
                update(draft.yearTo && Number(draft.yearTo) < Number(yearFrom) ? { yearFrom, yearTo: yearFrom } : { yearFrom })
              }
            />
            {fieldError('yearFrom')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-year-to">{t('search.yearTo')}</Label>
            <YearPicker
              id="filter-year-to"
              ariaLabel={t('search.yearTo')}
              placeholder="2020"
              value={draft.yearTo}
              min={draft.yearFrom ? Number(draft.yearFrom) : undefined}
              invalid={!!errors.yearTo}
              onChange={(yearTo) => update({ yearTo })}
            />
            {fieldError('yearTo')}
          </div>
          <div className="grid gap-1.5">
            <Label className="invisible hidden md:block">{t('search.submit')}</Label>
            <Button type="submit" disabled={searching} className="w-full md:w-auto">
              <Search />
              {t('search.submit')}
            </Button>
          </div>

          <div className="grid gap-1.5 lg:col-start-1">
            <Label htmlFor="filter-body">{t('search.bodyStyle')}</Label>
            <Select value={draft.bodyStyle || ANY} onValueChange={(v) => update({ bodyStyle: v === ANY ? '' : v })}>
              <SelectTrigger id="filter-body" className="w-full" aria-label={t('search.bodyStyle')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('search.any')}</SelectItem>
                {bodyOptions.map((b) => (
                  <SelectItem key={b} value={b}>
                    {t(`bodyStyles.${b}`, { defaultValue: b })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-transmission">{t('search.transmission')}</Label>
            <Select
              value={draft.transmission || ANY}
              onValueChange={(v) => update({ transmission: v === ANY ? '' : (v as Transmission) })}
            >
              <SelectTrigger id="filter-transmission" className="w-full" aria-label={t('search.transmission')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('search.any')}</SelectItem>
                {TRANSMISSIONS.map((x) => (
                  <SelectItem key={x} value={x}>
                    {t(`search.transmissions.${x}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-engine">{t('search.engine')}</Label>
            <Input
              id="filter-engine"
              value={draft.engine}
              inputMode="decimal"
              maxLength={4}
              placeholder={t('search.enginePlaceholder')}
              aria-invalid={!!errors.engine}
              onChange={(e) => update({ engine: e.target.value })}
            />
            {fieldError('engine')}
          </div>
          <div className="grid gap-1.5 lg:col-span-2">
            <Label htmlFor="filter-iaai-market">{t('search.iaaiMarket')}</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button id="filter-iaai-market" variant="outline" className="justify-between font-normal">
                  <span className="truncate">
                    {draft.iaaiMarkets.length === IAAI_MARKETS.length
                      ? t('search.allMarkets')
                      : draft.iaaiMarkets.map((m) => t(`search.markets.${m}`)).join(', ')}
                  </span>
                  <ChevronDown className="opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {IAAI_MARKETS.map((m) => (
                  <DropdownMenuCheckboxItem
                    key={m}
                    checked={draft.iaaiMarkets.includes(m)}
                    onCheckedChange={() => toggleMarket(m)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {t(`search.markets.${m}`)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
