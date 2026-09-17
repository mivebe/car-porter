import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { AliasScanSource } from '@/lib/api';
import { cn } from '@/lib/utils';
import { SiteMark } from './alias-card';
import { useAliasScan } from './alias-hooks';

/** Starts the scan of every site make and model; while it runs it stops it. */
export function ScanButton() {
  const { t } = useTranslation();
  const { status, start, cancel } = useAliasScan();

  if (status.data?.state === 'running') {
    return (
      <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending} data-testid="alias-scan">
        <Loader2 className="animate-spin" />
        {t('aliases.scan.cancel')}
      </Button>
    );
  }
  return (
    <Button onClick={() => start.mutate(undefined)} disabled={start.isPending} data-testid="alias-scan">
      <RefreshCw />
      {t('aliases.scan.startAll')}
    </Button>
  );
}

/** Per-site progress of a running scan; renders nothing otherwise. */
export function ScanProgress() {
  const { status } = useAliasScan();
  const scan = status.data;
  if (scan?.state !== 'running') return null;
  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-testid="alias-scan-progress">
      {scan.sources.map((p) => (
        <SourceProgress key={p.source} progress={p} />
      ))}
    </ul>
  );
}

function SourceProgress({ progress: p }: { progress: AliasScanSource }) {
  const { t } = useTranslation();
  const active = p.phase === 'makes' || p.phase === 'models' || p.phase === 'queued';
  const percent = p.phase === 'done' ? 100 : p.phase === 'models' && p.total > 0 ? Math.round((p.done / p.total) * 100) : null;
  const detail =
    p.phase === 'makes'
      ? t('aliases.scan.makesProgress', { count: p.requests, years: p.current ?? '' })
      : p.phase === 'models'
        ? `${p.done}/${p.total}${p.current ? ` · ${p.current}` : ''}`
        : null;

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border bg-card/40 px-3 py-2 text-sm" data-testid={`alias-scan-${p.source}`}>
      <div className="flex min-w-0 items-center gap-2">
        <SiteMark source={p.source} />
        {active && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        <span className="shrink-0">{t(`aliases.scan.phase.${p.phase}`)}</span>
        {detail && <span className="truncate tabular-nums text-muted-foreground">{detail}</span>}
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        {percent === null ? (
          // reading makes has no known total: an indeterminate sweep
          active && <div className="absolute inset-y-0 w-1/3 animate-[scan-sweep_1.4s_ease-in-out_infinite] rounded-full bg-brand" />
        ) : (
          <div className={cn('h-full rounded-full transition-all', p.phase === 'failed' ? 'bg-destructive' : 'bg-brand')} style={{ width: `${percent}%` }} />
        )}
      </div>
      {p.error && <p className="text-xs text-destructive">{p.error.message}</p>}
      {p.failed.length > 0 && (
        <p className="truncate text-xs text-muted-foreground">
          {t('aliases.scan.failedMakes', { makes: p.failed.map((f) => f.make).join(', ') })}
        </p>
      )}
    </li>
  );
}
