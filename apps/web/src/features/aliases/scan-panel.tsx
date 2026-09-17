import { Loader2, RefreshCw, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SourceBadge } from '@/features/search/source-badge';
import type { AliasScanSource } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useAliasScan } from './alias-hooks';

/** Starts/cancels the background scan of site makes and models and shows its progress. */
export function ScanPanel({ make }: { make: string | null }) {
  const { t, i18n } = useTranslation();
  const { status, start, cancel } = useAliasScan();
  const scan = status.data;
  const running = scan?.state === 'running';

  return (
    <Card className="py-4" data-testid="alias-scan">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium">{t('aliases.scan.title')}</p>
            <p className="text-muted-foreground">
              {running
                ? scan.make
                  ? t('aliases.scan.runningMake', { make: scan.make })
                  : t('aliases.scan.runningAll')
                : scan?.finishedAt
                  ? t(`aliases.scan.finished.${scan.state === 'cancelled' ? 'cancelled' : 'done'}`, {
                      when: formatRelative(scan.finishedAt, i18n.language),
                    })
                  : t('aliases.scan.hint')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {running ? (
              <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                <Square />
                {t('aliases.scan.cancel')}
              </Button>
            ) : (
              <>
                {make && (
                  <Button variant="outline" onClick={() => start.mutate(make)} disabled={start.isPending}>
                    <RefreshCw />
                    {t('aliases.scan.startMake', { make })}
                  </Button>
                )}
                <Button onClick={() => start.mutate(undefined)} disabled={start.isPending}>
                  <RefreshCw />
                  {t('aliases.scan.startAll')}
                </Button>
              </>
            )}
          </div>
        </div>
        {scan && scan.sources.length > 0 && scan.state !== 'idle' && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {scan.sources.map((s) => (
              <SourceProgress key={s.source} progress={s} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SourceProgress({ progress: p }: { progress: AliasScanSource }) {
  const { t } = useTranslation();
  const percent = p.phase === 'done' ? 100 : p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const active = p.phase === 'makes' || p.phase === 'models';
  return (
    <li className="flex flex-col gap-1.5 rounded-md border p-2 text-sm" data-testid={`alias-scan-${p.source}`}>
      <div className="flex items-center gap-2">
        <SourceBadge source={p.source} />
        {active && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        <span>{t(`aliases.scan.phase.${p.phase}`)}</span>
        {p.phase === 'models' && (
          <span className="tabular-nums text-muted-foreground">
            {p.done}/{p.total}
            {p.current && ` · ${p.current}`}
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      {p.error && <p className="text-xs text-destructive">{t(`sourceErrors.${p.error.code}`)}: {p.error.message}</p>}
      {p.failed.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('aliases.scan.failedMakes', { makes: p.failed.map((f) => f.make).join(', ') })}
        </p>
      )}
    </li>
  );
}
