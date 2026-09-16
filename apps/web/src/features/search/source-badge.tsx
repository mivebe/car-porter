import type { Lot } from '@car-porter/core';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function SourceBadge({ source }: { source: Lot['source'] }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      className={cn(
        source === 'copart'
          ? 'border-blue-500/40 text-blue-600 dark:text-blue-400'
          : 'border-red-500/40 text-red-600 dark:text-red-400',
      )}
    >
      {t(`sources.${source}`)}
    </Badge>
  );
}
