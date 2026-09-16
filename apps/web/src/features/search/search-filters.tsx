import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type LotSearchParams } from '@/lib/api';
import { validateFilters, type FilterDraft, type FilterErrors } from './validate-filters';
import { Combobox } from './combobox';

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
  });
  const [errors, setErrors] = useState<FilterErrors>({});

  const makes = useQuery({ queryKey: ['catalog', 'makes'], queryFn: api.makes, staleTime: Infinity });
  const models = useQuery({
    queryKey: ['catalog', 'models', draft.make.toLowerCase()],
    queryFn: () => api.models(draft.make),
    enabled: !!draft.make,
    staleTime: Infinity,
  });

  const update = (patch: Partial<FilterDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(patch) as (keyof FilterDraft)[]) delete next[key];
      return next;
    });
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
        <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-[1.2fr_1.2fr_0.6fr_0.6fr_auto] md:items-start">
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
            <Label htmlFor="filter-year-from">{t('search.yearFrom')}</Label>
            <Input
              id="filter-year-from"
              inputMode="numeric"
              placeholder="2018"
              value={draft.yearFrom}
              aria-invalid={!!errors.yearFrom}
              onChange={(e) => update({ yearFrom: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            />
            {fieldError('yearFrom')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-year-to">{t('search.yearTo')}</Label>
            <Input
              id="filter-year-to"
              inputMode="numeric"
              placeholder="2020"
              value={draft.yearTo}
              aria-invalid={!!errors.yearTo}
              onChange={(e) => update({ yearTo: e.target.value.replace(/\D/g, '').slice(0, 4) })}
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
        </form>
      </CardContent>
    </Card>
  );
}
