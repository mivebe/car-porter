import type { LotEvaluation, VerdictStatus } from '@car-porter/core';
import {
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CircleX,
  Scale,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Separator } from '@/components/ui/separator';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Section } from './section';

const STYLES: Record<VerdictStatus, { icon: LucideIcon; text: string; panel: string }> = {
  worth: { icon: CircleCheck, text: 'text-success', panel: 'border-success/40 bg-success/10' },
  borderline: { icon: CircleMinus, text: 'text-warning', panel: 'border-warning/40 bg-warning/10' },
  not_worth: {
    icon: CircleX,
    text: 'text-destructive',
    panel: 'border-destructive/40 bg-destructive/10',
  },
  insufficient: { icon: CircleHelp, text: 'text-muted-foreground', panel: 'bg-muted/30' },
};

export function VerdictBadge({ status, className }: { status: VerdictStatus; className?: string }) {
  const { t } = useTranslation();
  const { icon: Icon, text } = STYLES[status];
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 font-semibold', text, className)}
      data-testid="verdict-status"
    >
      <Icon className="size-4 shrink-0" />
      {t(`verdict.status.${status}`)}
    </span>
  );
}

function Row({
  label,
  value,
  strong,
  testId,
}: {
  label: string;
  value: string;
  strong?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-0.5 text-sm',
        strong && 'font-semibold',
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

export function VerdictSection({ evaluation }: { evaluation: LotEvaluation }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const eur = (c: number | null) => formatMoney(c, 'EUR', lang);
  const { verdict, cost } = evaluation;
  const minus = (c: number) => (c === 0 ? eur(0) : `−${eur(c)}`);

  return (
    <Section icon={Scale} title={t('verdict.title')} testId="verdict-section">
      <div className={cn('grid gap-3 rounded-lg border px-4 py-3', STYLES[verdict.status].panel)}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <VerdictBadge status={verdict.status} className="text-base" />
          {verdict.marginEurCents != null && (
            <span className="text-xl font-semibold tabular-nums" data-testid="verdict-margin">
              {eur(verdict.marginEurCents)}
            </span>
          )}
        </div>

        {verdict.status === 'insufficient' ? (
          <ul className="grid gap-1 text-sm text-muted-foreground" data-testid="verdict-missing">
            {verdict.missing.map((item) => (
              <li key={item}>• {t(`verdict.missing.${item}`)}</li>
            ))}
          </ul>
        ) : (
          <div>
            <Row
              label={t('verdict.rows.marketAverage')}
              value={eur(evaluation.marketAverageEurCents)}
            />
            <Row label={t('verdict.rows.total')} value={minus(cost?.totalEurCents ?? 0)} />
            <Row label={t('verdict.rows.repair')} value={minus(evaluation.repairEurCents)} />
            <Separator className="my-1.5" />
            <Row strong label={t('verdict.rows.margin')} value={eur(verdict.marginEurCents)} />
          </div>
        )}

        {(evaluation.bidSource === 'buyNow' || evaluation.bidSource === 'currentBid') && (
          <p className="text-xs text-muted-foreground">{t(`verdict.bidBasis.${evaluation.bidSource}`)}</p>
        )}
      </div>
    </Section>
  );
}
