import { calculateCost, resolveBid, type Lot, type LotInputs, type Settings } from '@car-porter/core';
import { Calculator, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import type { FxResponse } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { MoneyInput } from './money-input';
import { Section } from './section';

interface CostSectionProps {
  lot: Lot;
  inputs: LotInputs;
  settings: Settings;
  fx: FxResponse | undefined;
  fxError: boolean;
  /** Average of included bidfax matches, once estimated (task 23). */
  estimateUsdCents: number | null;
  onChange: (patch: Partial<LotInputs>) => void;
}

function Row({ label, value, muted, strong, testId }: { label: string; value: string; muted?: boolean; strong?: boolean; testId?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 text-sm ${muted ? 'text-muted-foreground' : ''}`}>
      <span>{label}</span>
      <span data-testid={testId} className={`tabular-nums ${strong ? 'text-base font-semibold' : ''}`}>
        {value}
      </span>
    </div>
  );
}

export function CostSection({ lot, inputs, settings, fx, fxError, estimateUsdCents, onChange }: CostSectionProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const usd = (c: number) => formatMoney(c, 'USD', lang, { decimals: true });
  const eur = (c: number) => formatMoney(c, 'EUR', lang, { decimals: true });

  const bid = resolveBid({
    overrideUsdCents: inputs.bidOverrideUsdCents,
    estimateUsdCents,
    buyNowUsdCents: lot.buyNowUsdCents,
    currentBidUsdCents: lot.currentBidUsdCents,
  });
  const breakdown =
    bid.bidUsdCents != null && fx
      ? calculateCost({
          bidUsdCents: bid.bidUsdCents,
          usdToEur: fx.usdToEur,
          feesReduced: inputs.feesReduced,
          includeSofiaToBg: inputs.includeSofiaToBg,
          cost: settings.cost,
        })
      : null;

  return (
    <Section icon={Calculator} title={t('cost.title')} testId="cost-section">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="bid-input">{t('cost.bid')}</Label>
          <div className="flex gap-2">
            <MoneyInput
              id="bid-input"
              currency="USD"
              valueCents={bid.bidUsdCents}
              onCommit={(cents) => onChange({ bidOverrideUsdCents: cents })}
            />
            {inputs.bidOverrideUsdCents != null && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('cost.resetBid')}
                onClick={() => onChange({ bidOverrideUsdCents: null })}
              >
                <RotateCcw />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground" data-testid="bid-source">
            {t(`cost.bidSource.${bid.source}`)}
          </p>
        </div>
        <div className="grid content-start gap-3 pt-1">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="fees-reduced" className="font-normal">
              {t('cost.feesReduced', { divisor: settings.cost.reducedDivisor })}
            </Label>
            <Switch id="fees-reduced" checked={inputs.feesReduced} onCheckedChange={(v) => onChange({ feesReduced: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="sofia-to-bg" className="font-normal">
              {t('cost.includeSofiaToBg', { amount: formatMoney(settings.cost.sofiaToBgEur * 100, 'EUR', lang) })}
            </Label>
            <Switch
              id="sofia-to-bg"
              checked={inputs.includeSofiaToBg}
              onCheckedChange={(v) => onChange({ includeSofiaToBg: v })}
            />
          </div>
        </div>
      </div>

      {fxError && !fx && <p className="text-sm text-destructive">{t('cost.fxUnavailable')}</p>}
      {!breakdown && bid.bidUsdCents == null && <p className="text-sm text-muted-foreground">{t('cost.enterBid')}</p>}

      {breakdown && fx && (
        <div className="rounded-lg border bg-muted/30 px-4 py-3" data-testid="cost-breakdown">
          <Row label={t('cost.rows.bid')} value={usd(breakdown.bidUsdCents)} />
          {breakdown.feeParts.map((part, i) => (
            <Row
              key={i}
              muted
              label={t('cost.rows.feePart', { percent: +part.effectivePercent.toFixed(2) })}
              value={usd(part.usdCents)}
            />
          ))}
          <Row label={t('cost.rows.shipping')} value={usd(breakdown.shippingUsaRotterdamUsdCents)} />
          <Separator className="my-2" />
          <Row label={t('cost.rows.usdSubtotal')} value={usd(breakdown.usdSubtotalCents)} testId="usd-subtotal" />
          <Row
            muted
            label={t(fx.source === 'override' ? 'cost.rows.fxOverride' : 'cost.rows.fxEcb', {
              rate: fx.usdToEur.toFixed(4),
              date: formatDate(fx.ecb?.date, lang),
            })}
            value={eur(breakdown.usdSubtotalEurCents)}
          />
          <Row label={t('cost.rows.rotterdamSofia')} value={eur(breakdown.rotterdamSofiaEurCents)} />
          {inputs.includeSofiaToBg && <Row label={t('cost.rows.sofiaToBg')} value={eur(breakdown.sofiaToBgEurCents)} />}
          <Separator className="my-2" />
          <Row strong label={t('cost.rows.total')} value={eur(breakdown.totalEurCents)} testId="cost-total" />
        </div>
      )}
    </Section>
  );
}
