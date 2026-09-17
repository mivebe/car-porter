import { DEFAULT_SETTINGS, MARKET_SOURCES, settingsSchema, type Settings } from '@car-porter/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, Plus, RotateCcw, Save, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useFx, useSettings } from '@/features/lot/hooks';
import { NumberField } from '@/features/settings/number-field';
import { TRACKED_KEY } from '@/features/tracking/tracking-hooks';
import { SUPPORTED_LANGUAGES, type Language } from '@/i18n';
import { api } from '@/lib/api';
import { useUpdatePreferences } from '@/lib/preferences';
import { useTheme, type Theme } from '@/lib/theme';

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useSettings();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('pages.settings.title')} />
      {settings.isPending && <Skeleton className="h-96 w-full" />}
      {settings.isError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
        >
          {t('settings.loadFailed')}
        </div>
      )}
      {settings.data && <SettingsForm saved={settings.data} />}
    </div>
  );
}

function SettingsCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

/** Language and theme apply immediately, so they are left out of the saved form. */
const withoutUi = (s: Settings) => JSON.stringify({ ...s, ui: undefined });

function SettingsForm({ saved }: { saved: Settings }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fx = useFx();
  const [draft, setDraft] = useState<Settings>(saved);
  // remounts the number fields when values change from outside (save, discard, defaults)
  const [formKey, setFormKey] = useState(0);

  const replaceDraft = (next: Settings) => {
    setDraft(next);
    setFormKey((k) => k + 1);
  };
  const update = (mutate: (next: Settings) => void) =>
    setDraft((prev) => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });

  const validation = settingsSchema.safeParse(draft);
  const errors = new Map<string, string>();
  if (!validation.success) {
    for (const issue of validation.error.issues) {
      const path = issue.path.join('.');
      errors.set(
        path,
        t(path === 'scraping' ? 'settings.errors.delayOrder' : 'settings.errors.invalid'),
      );
    }
  }
  const dirty = withoutUi(draft) !== withoutUi(saved);

  const save = useMutation({
    mutationFn: () => api.updateSettings({ ...draft, ui: undefined }),
    onSuccess: (next) => {
      queryClient.setQueryData(['settings'], next);
      // the manual rate and every cost/verdict input may have changed
      void queryClient.invalidateQueries({ queryKey: ['fx'] });
      void queryClient.invalidateQueries({ queryKey: TRACKED_KEY });
      replaceDraft(next);
      toast.success(t('settings.saved'));
    },
    onError: () => toast.error(t('settings.saveFailed')),
  });

  const num = (value: number | null) => value as number;
  const field = (
    id: string,
    path: string,
    label: string,
    value: number | null,
    set: (v: number | null) => void,
    extra: { unit?: string; placeholder?: string } = {},
  ) => (
    <NumberField
      key={`${id}-${formKey}`}
      id={id}
      label={label}
      value={value}
      onChange={set}
      error={errors.get(path)}
      {...extra}
    />
  );

  const percents = draft.cost.bidPercentages;
  const totalPercent = percents.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && validation.success) save.mutate();
      }}
    >
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <SettingsCard title={t('settings.cost.title')}>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm">{t('settings.cost.percentages')}</legend>
            {percents.map((percent, i) => (
              <div key={`${i}-${formKey}`} className="flex items-end gap-2">
                <NumberField
                  id={`fee-part-${i}`}
                  className="flex-1"
                  label={t('settings.cost.part', { n: i + 1 })}
                  unit="%"
                  value={percent}
                  error={errors.get(`cost.bidPercentages.${i}`)}
                  onChange={(v) => update((d) => void (d.cost.bidPercentages[i] = num(v)))}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={percents.length <= 1}
                  aria-label={t('settings.cost.removePart', { n: i + 1 })}
                  onClick={() =>
                    replaceDraft({
                      ...draft,
                      cost: { ...draft.cost, bidPercentages: percents.filter((_, j) => j !== i) },
                    })
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  replaceDraft({
                    ...draft,
                    cost: { ...draft.cost, bidPercentages: [...percents, 0] },
                  })
                }
              >
                <Plus />
                {t('settings.cost.addPart')}
              </Button>
              <span className="text-xs text-muted-foreground" data-testid="fee-total">
                {t('settings.cost.totalPercent', {
                  total: +totalPercent.toFixed(2),
                  reduced: +(totalPercent / (draft.cost.reducedDivisor || 1)).toFixed(2),
                })}
              </span>
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              'reduced-divisor',
              'cost.reducedDivisor',
              t('settings.cost.reducedDivisor'),
              draft.cost.reducedDivisor,
              (v) => update((d) => void (d.cost.reducedDivisor = num(v))),
            )}
            {field(
              'shipping-usa',
              'cost.shippingUsaRotterdamUsd',
              t('settings.cost.shippingUsaRotterdamUsd'),
              draft.cost.shippingUsaRotterdamUsd,
              (v) => update((d) => void (d.cost.shippingUsaRotterdamUsd = num(v))),
              { unit: 'USD' },
            )}
            {field(
              'rotterdam-sofia',
              'cost.rotterdamSofiaEur',
              t('settings.cost.rotterdamSofiaEur'),
              draft.cost.rotterdamSofiaEur,
              (v) => update((d) => void (d.cost.rotterdamSofiaEur = num(v))),
              { unit: 'EUR' },
            )}
            {field(
              'sofia-bg',
              'cost.sofiaToBgEur',
              t('settings.cost.sofiaToBgEur'),
              draft.cost.sofiaToBgEur,
              (v) => update((d) => void (d.cost.sofiaToBgEur = num(v))),
              { unit: 'EUR' },
            )}
          </div>
        </SettingsCard>

        <div className="grid gap-6">
          <SettingsCard
            title={t('settings.verdict.title')}
          >
            {field(
              'worth-threshold',
              'verdict.worthThresholdEur',
              t('settings.verdict.worthThresholdEur'),
              draft.verdict.worthThresholdEur,
              (v) => update((d) => void (d.verdict.worthThresholdEur = num(v))),
              { unit: 'EUR' },
            )}
          </SettingsCard>

          <SettingsCard title={t('settings.fx.title')}>
            {field(
              'fx-override',
              'fx.usdToEurOverride',
              t('settings.fx.override'),
              draft.fx.usdToEurOverride,
              (v) => update((d) => void (d.fx.usdToEurOverride = v)),
              {
                placeholder: fx.data?.ecb ? fx.data.ecb.usdToEur.toFixed(4) : undefined,
              },
            )}
          </SettingsCard>
        </div>

        <SettingsCard
          title={t('settings.bidfax.title')}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {field(
              'bidfax-months',
              'bidfax.maxMonths',
              t('settings.bidfax.maxMonths'),
              draft.bidfax.maxMonths,
              (v) => update((d) => void (d.bidfax.maxMonths = num(v))),
            )}
            {field(
              'bidfax-matches',
              'bidfax.maxMatches',
              t('settings.bidfax.maxMatches'),
              draft.bidfax.maxMatches,
              (v) => update((d) => void (d.bidfax.maxMatches = num(v))),
            )}
            {field(
              'bidfax-pages',
              'bidfax.maxPages',
              t('settings.bidfax.maxPages'),
              draft.bidfax.maxPages,
              (v) => update((d) => void (d.bidfax.maxPages = num(v))),
            )}
          </div>
        </SettingsCard>

        <SettingsCard
          title={t('settings.market.title')}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              'mileage-range',
              'market.mileageRangeKm',
              t('settings.market.mileageRangeKm'),
              draft.market.mileageRangeKm,
              (v) => update((d) => void (d.market.mileageRangeKm = num(v))),
              { unit: t('units.kmSuffix') },
            )}
            {field(
              'market-pages',
              'market.maxPages',
              t('settings.market.maxPages'),
              draft.market.maxPages,
              (v) => update((d) => void (d.market.maxPages = num(v))),
            )}
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm">{t('settings.market.defaultSources')}</legend>
            {MARKET_SOURCES.map((site) => (
              <div key={site} className="flex items-center justify-between gap-3">
                <Label htmlFor={`default-source-${site}`} className="font-normal">
                  {t(`market.sites.${site}`)}
                </Label>
                <Switch
                  id={`default-source-${site}`}
                  checked={draft.market.enabledSources[site] ?? false}
                  onCheckedChange={(v) => update((d) => void (d.market.enabledSources[site] = v))}
                />
              </div>
            ))}
          </fieldset>
        </SettingsCard>

        <SettingsCard
          title={t('settings.scraping.title')}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              'delay-min',
              'scraping.minDelayMs',
              t('settings.scraping.minDelayMs'),
              draft.scraping.minDelayMs,
              (v) => update((d) => void (d.scraping.minDelayMs = num(v))),
              { unit: 'ms' },
            )}
            <NumberField
              key={`delay-max-${formKey}`}
              id="delay-max"
              label={t('settings.scraping.maxDelayMs')}
              unit={t('units.msSuffix')}
              value={draft.scraping.maxDelayMs}
              error={errors.get('scraping.maxDelayMs') ?? errors.get('scraping')}
              onChange={(v) => update((d) => void (d.scraping.maxDelayMs = num(v)))}
            />
          </div>
        </SettingsCard>

        <div className="grid gap-6">
          <AppearanceCard />
          <CopartCard />
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background/90 px-4 py-3 backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          onClick={() => replaceDraft({ ...DEFAULT_SETTINGS, ui: draft.ui })}
        >
          <RotateCcw />
          {t('settings.resetDefaults')}
        </Button>
        <div className="flex items-center gap-2">
          {!validation.success && (
            <span className="text-sm text-destructive">{t('settings.fixErrors')}</span>
          )}
          {validation.success && dirty && (
            <span className="text-sm text-muted-foreground">{t('settings.unsaved')}</span>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!dirty}
            onClick={() => replaceDraft(saved)}
          >
            {t('settings.discard')}
          </Button>
          <Button type="submit" disabled={!dirty || !validation.success || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {t('settings.save')}
          </Button>
        </div>
      </div>
    </form>
  );
}

const THEMES = ['dark', 'light'] as const;

function AppearanceCard() {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const preferences = useUpdatePreferences();

  // Radix Select inside a <form> reports "" when its value is changed from outside (e.g. the saved
  // preferences arriving), so only real choices count
  return (
    <SettingsCard
      title={t('settings.appearance.title')}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="settings-language" className="font-normal">
            {t('header.language')}
          </Label>
          <Select
            value={i18n.language}
            onValueChange={(v) =>
              SUPPORTED_LANGUAGES.includes(v as Language) &&
              v !== i18n.language &&
              preferences.setLanguage(v as Language)
            }
          >
            <SelectTrigger id="settings-language" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LANGUAGES.map((lng) => (
                <SelectItem key={lng} value={lng}>
                  {t(`language.${lng}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="settings-theme" className="font-normal">
            {t('settings.appearance.theme')}
          </Label>
          <Select
            value={theme}
            onValueChange={(v) =>
              THEMES.includes(v as Theme) && v !== theme && preferences.setTheme(v as Theme)
            }
          >
            <SelectTrigger id="settings-theme" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEMES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`settings.appearance.themes.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </SettingsCard>
  );
}

function CopartCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['copartLogin'],
    queryFn: api.copartLogin,
    // notice when the user closes the window
    refetchInterval: (query) => (query.state.data?.windowOpen ? 3000 : false),
  });
  const open = useMutation({
    mutationFn: api.openCopartLogin,
    onSuccess: (data) => queryClient.setQueryData(['copartLogin'], data),
  });
  const windowOpen = status.data?.windowOpen ?? false;

  return (
    <SettingsCard title={t('settings.copart.title')}>
      <p className="text-sm" data-testid="copart-login-status">
        {windowOpen ? t('settings.copart.windowOpen') : t('settings.copart.windowClosed')}
      </p>
      {open.isError && (
        <p className="text-sm text-destructive" role="alert">
          {t('settings.copart.openFailed')}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        disabled={windowOpen || open.isPending}
        onClick={() => open.mutate()}
      >
        {open.isPending ? <Loader2 className="animate-spin" /> : <ExternalLink />}
        {t('settings.copart.open')}
      </Button>
    </SettingsCard>
  );
}
