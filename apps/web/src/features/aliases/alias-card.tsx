import { useDndContext, useDraggable } from '@dnd-kit/core';
import { Ban, RotateCcw, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import type { AliasEntry } from '@/lib/api';
import { formatNumber, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { effectiveTargets } from './alias-hooks';
import { cardId, type AliasColumn } from './drop-plan';
import { SourceBadge } from '@/features/search/source-badge';

/** Hovering a card this long shows its details. */
const DETAILS_HOVER_DELAY_MS = 1200;

export type CardAction = 'ignore' | 'unassign' | 'reset';

/** The visual card, shared by the list and the drag overlay. */
export function CardFace({ entry, showMake, className }: { entry: AliasEntry; showMake?: boolean; className?: string }) {
  const { i18n } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5 text-left text-sm shadow-xs',
        className,
      )}
    >
      <SourceBadge source={entry.source} />
      <span className="truncate font-medium">{entry.externalName}</span>
      {showMake && entry.make && <span className="truncate text-xs text-muted-foreground">· {entry.make}</span>}
      {entry.lotCount != null && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatNumber(entry.lotCount, i18n.language)}</span>
      )}
    </span>
  );
}

interface AliasCardProps {
  entry: AliasEntry;
  column: AliasColumn;
  selected: boolean;
  showMake?: boolean;
  onToggleSelect: () => void;
  onAction: (entry: AliasEntry, action: CardAction) => void;
}

/**
 * A draggable site name. Details open after hovering a moment, or on a click that isn't a drag;
 * Ctrl/Cmd/Shift-click selects it so several cards can be dragged together.
 */
export function AliasCard({ entry, column, selected, showMake, onToggleSelect, onAction }: AliasCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${column}:${cardId(entry)}`,
    data: { entry, column },
  });
  const { active } = useDndContext();
  const [open, setOpen] = useState<'hover' | 'click' | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const cardRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  // never show details while anything is being dragged
  const shown = active ? null : open;

  const card = (
    <button
      ref={(el) => {
        setNodeRef(el);
        cardRef.current = el;
      }}
      type="button"
      {...attributes}
      {...listeners}
      aria-pressed={selected}
      data-testid="alias-card"
      data-no-title
      data-name={entry.externalName}
      data-source={entry.source}
      onPointerDown={(event) => {
        window.clearTimeout(timer.current);
        setOpen((o) => (o === 'hover' ? null : o));
        listeners?.onPointerDown?.(event);
      }}
      onPointerEnter={() => {
        if (active || open) return;
        timer.current = window.setTimeout(() => setOpen('hover'), DETAILS_HOVER_DELAY_MS);
      }}
      onPointerLeave={() => {
        window.clearTimeout(timer.current);
        setOpen((o) => (o === 'hover' ? null : o));
      }}
      onClick={(event) => {
        window.clearTimeout(timer.current);
        if (event.ctrlKey || event.metaKey || event.shiftKey) onToggleSelect();
        else setOpen((o) => (o === 'click' ? null : 'click'));
      }}
      className={cn(
        'max-w-full cursor-grab touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing',
        isDragging && 'opacity-30',
      )}
    >
      <CardFace
        entry={entry}
        showMake={showMake}
        className={cn('transition-colors hover:border-foreground/30', selected && 'border-primary bg-primary/10 ring-1 ring-primary')}
      />
    </button>
  );

  // Only the card whose details are open carries a Popover. Mounting one per card costs about a
  // second of drag-start lag on a full column: dnd-kit re-renders every draggable when a drag
  // begins, so each card's render has to stay cheap.
  if (shown === null) return card;

  return (
    <Popover open onOpenChange={(next) => !next && setOpen(null)}>
      <PopoverAnchor asChild>{card}</PopoverAnchor>
      <PopoverContent
        align="start"
        className={cn('w-72 p-3', shown === 'hover' && 'pointer-events-none')}
        onOpenAutoFocus={(e) => e.preventDefault()}
        // the card toggles its own details; don't let pressing it count as clicking outside
        onInteractOutside={(e) => {
          if (cardRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        data-testid="alias-details"
      >
        <AliasDetails
          entry={entry}
          actions={shown === 'click'}
          onAction={(action) => {
            setOpen(null);
            onAction(entry, action);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function AliasDetails({ entry, actions, onAction }: { entry: AliasEntry; actions: boolean; onAction: (a: CardAction) => void }) {
  const { t, i18n } = useTranslation();
  const auto = entry.auto.targets.length
    ? `${entry.auto.targets.join(', ')}${entry.auto.match ? ` (${t(`aliases.matchShort.${entry.auto.match}`)})` : ''}`
    : entry.auto.nonCarMake
      ? t('aliases.nonCarMake', { make: entry.auto.nonCarMake })
      : t('aliases.details.none');
  const yours = !entry.manual
    ? t('aliases.details.none')
    : entry.manual.state === 'assigned'
      ? entry.manual.targets.join(', ')
      : t(`aliases.status.${entry.manual.state}`);

  const row = (label: string, value: ReactNode) => (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  );

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-2">
        <SourceBadge source={entry.source} />
        <span className="font-semibold break-all">{entry.externalName}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {entry.kind === 'model' && row(t('aliases.details.make'), entry.make)}
        {row(t('aliases.details.lots'), entry.lotCount == null ? '-' : formatNumber(entry.lotCount, i18n.language))}
        {row(t('aliases.details.status'), t(`aliases.status.${entry.status}`))}
        {row(t('aliases.details.searchedAs'), effectiveTargets(entry).join(', ') || t('aliases.details.none'))}
        {row(t('aliases.details.automatic'), auto)}
        {row(t('aliases.details.yours'), yours)}
        {row(t('aliases.details.lastSeen'), formatRelative(entry.lastSeenAt, i18n.language))}
      </dl>
      {actions && (
        <div className="flex flex-wrap gap-1.5">
          {effectiveTargets(entry).length > 0 && (
            <Button size="sm" variant="outline" onClick={() => onAction('unassign')}>
              <Undo2 />
              {t('aliases.details.unassign')}
            </Button>
          )}
          {entry.status !== 'ignored' && (
            <Button size="sm" variant="outline" onClick={() => onAction('ignore')}>
              <Ban />
              {t('aliases.details.ignore')}
            </Button>
          )}
          {entry.manual && (
            <Button size="sm" variant="outline" onClick={() => onAction('reset')}>
              <RotateCcw />
              {t('aliases.details.reset')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
