import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AliasScanSource } from '@/lib/api';
import { useAliasScan } from './alias-hooks';

/** Starts the scan of every site make and model; while it runs it stops it, with per-site progress on hover. */
export function ScanButton() {
  const { t } = useTranslation();
  const { status, start, cancel } = useAliasScan();
  const scan = status.data;

  if (scan?.state !== 'running') {
    return (
      <Button onClick={() => start.mutate(undefined)} disabled={start.isPending} data-testid="alias-scan">
        <RefreshCw />
        {t('aliases.scan.startAll')}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending} data-testid="alias-scan">
          <Loader2 className="animate-spin" />
          {t('aliases.scan.cancel')}
        </Button>
      </TooltipTrigger>
      <TooltipContent align="end" className="max-w-sm">
        <ul className="grid gap-1" data-testid="alias-scan-progress">
          {scan.sources.map((p) => (
            <li key={p.source}>
              <SourceProgress progress={p} />
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

function SourceProgress({ progress: p }: { progress: AliasScanSource }) {
  const { t } = useTranslation();
  const detail =
    p.phase === 'makes'
      ? t('aliases.scan.makesProgress', { count: p.requests, years: p.current ?? '' })
      : p.phase === 'models'
        ? `${p.done}/${p.total}${p.current ? ` · ${p.current}` : ''}`
        : null;
  return (
    <span>
      <span className="font-semibold">{t(`sources.${p.source}`)}</span>: {t(`aliases.scan.phase.${p.phase}`)}
      {detail && <span className="tabular-nums"> · {detail}</span>}
      {p.error && <span> · {p.error.message}</span>}
    </span>
  );
}
