import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  rectIntersection,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { AuctionSource } from '@car-porter/core';
import { ChevronDown, ChevronRight, MousePointerClick, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { AliasChange, AliasEntry, AliasKind, AliasStatus, CanonicalItem } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AliasCard, CardFace, type CardAction } from './alias-card';
import { useAliases, useAliasMakes, useCanonicalItems, useChangeAliases } from './alias-hooks';
import { cardId, planDrop, type AliasColumn, type DropOutcome, type DropTarget } from './drop-plan';
import { siteColor } from './site-color';

const CANONICAL_PREFIX = 'canonical:';
const norm = (s: string) => s.trim().toLowerCase();

/**
 * Cards rendered per column before "show more". Dragging re-renders every card on the board (each
 * one is a dnd-kit draggable), so a column of 500 names makes a drag take over a second to start.
 */
const PAGE_SIZE = 100;

/** Drop on whatever is under the pointer (a make row inside a column wins); keyboard drags fall back to overlap. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length === 0) return rectIntersection(args);
  return [...hits].sort((a, b) => Number(String(b.id).startsWith(CANONICAL_PREFIX)) - Number(String(a.id).startsWith(CANONICAL_PREFIX)));
};

const targetOf = (id: string | number | undefined): DropTarget | null => {
  if (typeof id !== 'string') return null;
  if (id === 'assigned' || id === 'pool') return { type: id };
  return id.startsWith(CANONICAL_PREFIX) ? { type: 'canonical', name: id.slice(CANONICAL_PREFIX.length) } : null;
};

interface AliasBoardProps {
  kind: AliasKind;
  /** models: the make whose models are shown ('' = none chosen) */
  make: string;
  source?: AuctionSource;
  status?: AliasStatus;
  q: string;
  active: string | null;
  onActiveChange: (name: string | null) => void;
  onMakeChange: (make: string) => void;
}

interface DragState {
  entries: AliasEntry[];
  from: AliasColumn;
}

/**
 * Three columns: our makes/models (left), the site names searched as the selected one (middle)
 * and the site names in the right-hand list (unassigned by default). Cards are dragged between them.
 */
export function AliasBoard({ kind, make, source, status, q, active, onActiveChange, onMakeChange }: AliasBoardProps) {
  const { t } = useTranslation();
  const scoped = kind === 'make' || !!make;
  const modelMake = kind === 'model' ? make || undefined : undefined;

  const canonical = useCanonicalItems({ kind, make: modelMake, source });
  const assigned = useAliases({ kind, make: modelMake, source, target: active ?? undefined, limit: 2000 }, !!active && scoped);
  const pool = useAliases({ kind, make: modelMake, source, status, q: q || undefined });
  const change = useChangeAliases();

  // selection and paging only count for the lists they were made in
  const scope = [kind, make, source, status, q, active].join('|');
  const [selection, setSelection] = useState<{ scope: string; column: AliasColumn; ids: Set<string> }>({
    scope,
    column: 'pool',
    ids: new Set(),
  });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [shownCounts, setShownCounts] = useState<{ scope: string } & Record<AliasColumn, number>>({
    scope,
    pool: PAGE_SIZE,
    assigned: PAGE_SIZE,
  });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const [add, setAdd] = useState(false);

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => setAdd(e.altKey);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [drag]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const selectedIn = (column: AliasColumn) =>
    selection.scope === scope && selection.column === column ? selection.ids : new Set<string>();
  const listOf = (column: AliasColumn) => ((column === 'pool' ? pool.data?.items : assigned.data?.items) ?? []);
  const visible = (column: AliasColumn) => listOf(column).filter((e) => !hidden.has(cardId(e)));
  /** How many of a column's cards are rendered; the rest wait behind "show more". */
  const shownCount = (column: AliasColumn) => (shownCounts.scope === scope ? shownCounts[column] : PAGE_SIZE);
  const showMore = (column: AliasColumn) =>
    setShownCounts((c) => {
      const base = c.scope === scope ? c : { scope, pool: PAGE_SIZE, assigned: PAGE_SIZE };
      return { ...base, scope, [column]: base[column] + PAGE_SIZE };
    });

  const apply = async (changes: AliasChange[], ids: string[]) => {
    if (changes.length === 0) return;
    setHidden((h) => new Set([...h, ...ids]));
    try {
      await change.mutateAsync(changes);
    } catch {
      toast.error(t('aliases.board.saveFailed'));
    } finally {
      setHidden((h) => new Set([...h].filter((id) => !ids.includes(id))));
      setSelection((s) => ({ ...s, ids: new Set() }));
    }
  };

  const outcome: DropOutcome | null =
    drag && over ? planDrop({ entries: drag.entries, from: drag.from, to: over, active, add }).outcome : null;

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { entry: AliasEntry; column: AliasColumn };
    const id = cardId(data.entry);
    const group =
      selectedIn(data.column).has(id)
        ? visible(data.column).filter((e) => selection.ids.has(cardId(e)))
        : [data.entry];
    setAdd(event.activatorEvent instanceof MouseEvent && event.activatorEvent.altKey);
    setDrag({ entries: group, from: data.column });
  };

  const onDragOver = (event: DragOverEvent) => setOver(targetOf(event.over?.id));

  const onDragEnd = (event: DragEndEvent) => {
    const to = targetOf(event.over?.id);
    const current = drag;
    setDrag(null);
    setOver(null);
    if (!current || !to) return;
    const plan = planDrop({ entries: current.entries, from: current.from, to, active, add });
    if (plan.outcome.kind === 'needs-selection') toast.info(t('aliases.board.drop.needs-selection'));
    void apply(plan.changes, current.entries.map(cardId));
  };

  const onCardAction = (entry: AliasEntry, action: CardAction) => {
    const key = { source: entry.source, kind: entry.kind, externalName: entry.externalName, ...(entry.kind === 'model' ? { make: entry.make } : {}) };
    void apply([{ ...key, action }], [cardId(entry)]);
  };

  const toggleSelect = (column: AliasColumn, entry: AliasEntry) =>
    setSelection((s) => {
      const ids = new Set(s.scope === scope && s.column === column ? s.ids : []);
      const id = cardId(entry);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { scope, column, ids };
    });


  const poolSelected = visible('pool').filter((e) => selectedIn('pool').has(cardId(e)));
  const assignedCards = visible('assigned').slice(0, shownCount('assigned'));
  const poolCards = visible('pool').slice(0, shownCount('pool'));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDrag(null);
        setOver(null);
      }}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.1fr)_minmax(0,1.3fr)]">
        {scoped ? (
          <CanonicalColumn
            kind={kind}
            make={make}
            items={canonical.data?.items}
            loading={canonical.isPending}
            active={active}
            onActiveChange={onActiveChange}
            dragging={!!drag}
            over={over}
            outcome={outcome}
          />
        ) : (
          <MakePicker source={source} onPick={onMakeChange} />
        )}

        <AssignedColumn
          active={active}
          entries={visible('assigned')}
          loading={!!active && assigned.isPending}
          dragging={!!drag}
          isOver={over?.type === 'assigned'}
          outcome={over?.type === 'assigned' ? outcome : null}
          hiddenCount={visible('assigned').length - assignedCards.length}
          onShowMore={() => showMore('assigned')}
        >
          {assignedCards.map((e) => (
            <AliasCard
              key={cardId(e)}
              entry={e}
              column="assigned"
              selected={selectedIn('assigned').has(cardId(e))}
              onToggleSelect={() => toggleSelect('assigned', e)}
              onAction={onCardAction}
            />
          ))}
        </AssignedColumn>

        <PoolColumn
          status={status}
          total={pool.data?.total}
          shown={poolCards.length}
          onShowMore={visible('pool').length > poolCards.length ? () => showMore('pool') : undefined}
          loading={pool.isPending}
          failed={pool.isError}
          dragging={!!drag}
          isOver={over?.type === 'pool'}
          outcome={over?.type === 'pool' ? outcome : null}
          selectedCount={poolSelected.length}
          onIgnoreSelected={() =>
            void apply(
              poolSelected.map((e) => ({
                source: e.source,
                kind: e.kind,
                externalName: e.externalName,
                ...(e.kind === 'model' ? { make: e.make } : {}),
                action: 'ignore' as const,
              })),
              poolSelected.map(cardId),
            )
          }
          onClearSelection={() => setSelection({ scope, column: 'pool', ids: new Set() })}
        >
          {poolCards.map((e) => (
            <AliasCard
              key={cardId(e)}
              entry={e}
              column="pool"
              showMake={kind === 'model' && !make}
              selected={selectedIn('pool').has(cardId(e))}
              onToggleSelect={() => toggleSelect('pool', e)}
              onAction={onCardAction}
            />
          ))}
        </PoolColumn>
      </div>

      <DragOverlay dropAnimation={null}>
        {drag && (
          <div className="flex flex-col items-start gap-1.5" data-testid="alias-drag-overlay">
            <div className="relative">
              {drag.entries.length > 1 && (
                <span className="absolute top-1 left-1 h-full w-full rounded-lg border bg-card opacity-70" aria-hidden />
              )}
              <CardFace entry={drag.entries[0]!} className="relative cursor-grabbing border-primary shadow-lg" />
              {drag.entries.length > 1 && (
                <Badge className="absolute -top-2 -right-2 h-5 px-1.5 tabular-nums">{drag.entries.length}</Badge>
              )}
            </div>
            {outcome && outcome.kind !== 'none' && <DropLabel outcome={outcome} />}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function DropLabel({ outcome }: { outcome: DropOutcome }) {
  const { t } = useTranslation();
  const name = 'name' in outcome ? outcome.name : '';
  return (
    <span
      className={cn(
        'rounded-md px-2 py-0.5 text-xs font-medium shadow',
        outcome.kind === 'needs-selection'
          ? 'bg-destructive text-white'
          : outcome.kind === 'unassign'
            ? 'bg-amber-500 text-black'
            : 'bg-primary text-primary-foreground',
      )}
      data-testid="alias-drop-label"
    >
      {t(`aliases.board.drop.${outcome.kind}`, { name })}
    </span>
  );
}

function Column({
  title,
  count,
  children,
  header,
  className,
  testId,
  setRef,
}: {
  title: ReactNode;
  count?: ReactNode;
  children: ReactNode;
  header?: ReactNode;
  className?: string;
  testId: string;
  setRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <section
      ref={setRef}
      data-testid={testId}
      className={cn(
        'flex h-[22rem] flex-col lg:h-[calc(100svh-20rem)] lg:min-h-[26rem] overflow-hidden rounded-xl border bg-card/40 transition-colors',
        className,
      )}
    >
      <div className="flex flex-col gap-2 border-b px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {count !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>}
        </div>
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  );
}

function CanonicalColumn({
  kind,
  make,
  items,
  loading,
  active,
  onActiveChange,
  dragging,
  over,
  outcome,
}: {
  kind: AliasKind;
  make: string;
  items: CanonicalItem[] | undefined;
  loading: boolean;
  active: string | null;
  onActiveChange: (name: string | null) => void;
  dragging: boolean;
  over: DropTarget | null;
  outcome: DropOutcome | null;
}) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const [created, setCreated] = useState<string[]>([]);
  const [showEmpty, setShowEmpty] = useState(false);

  const all = useMemo(() => {
    const list = [...(items ?? [])];
    for (const name of [...created, ...(active ? [active] : [])]) {
      if (!list.some((i) => norm(i.name) === norm(name))) {
        list.push({ name, siteNames: 0, bySource: { copart: 0, iaai: 0 }, lots: 0 });
      }
    }
    return list;
  }, [items, created, active]);

  const term = norm(search);
  const matching = term ? all.filter((i) => norm(i.name).includes(term)) : all;
  const withNames = matching.filter((i) => i.siteNames > 0 || created.includes(i.name) || i.name === active);
  const without = matching.filter((i) => !withNames.includes(i));
  const canCreate = !!search.trim() && !all.some((i) => norm(i.name) === term);

  const row = (item: CanonicalItem) => (
    <CanonicalRow
      key={item.name}
      item={item}
      active={!!active && norm(active) === norm(item.name)}
      isOver={over?.type === 'canonical' && over.name === item.name}
      outcome={over?.type === 'canonical' && over.name === item.name ? outcome : null}
      dragging={dragging}
      onClick={() => onActiveChange(active && norm(active) === norm(item.name) ? null : item.name)}
    />
  );

  return (
    <Column
      testId="alias-canonical"
      title={kind === 'make' ? t('aliases.board.ourMakes') : t('aliases.board.ourModels', { make })}
      count={formatNumber(all.length, i18n.language)}
      header={
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-sm"
            value={search}
            placeholder={t(kind === 'make' ? 'aliases.board.findMake' : 'aliases.board.findModel')}
            aria-label={t(kind === 'make' ? 'aliases.board.findMake' : 'aliases.board.findModel')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      }
    >
      {loading && <ColumnSkeleton rows={8} />}
      <div className="flex flex-col gap-1">
        {canCreate && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-start text-primary"
            onClick={() => {
              const name = search.trim();
              setCreated((c) => [...c, name]);
              setSearch('');
              onActiveChange(name);
            }}
          >
            <Plus />
            {t('aliases.board.create', { name: search.trim() })}
          </Button>
        )}
        {withNames.map(row)}
        {without.length > 0 && (
          <>
            <button
              type="button"
              className="mt-2 flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowEmpty((v) => !v)}
              aria-expanded={showEmpty || !!term}
            >
              {showEmpty || term ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {t('aliases.board.withoutSiteNames', { count: without.length })}
            </button>
            {(showEmpty || !!term) && without.map(row)}
          </>
        )}
        {!loading && matching.length === 0 && !canCreate && (
          <p className="px-1 text-sm text-muted-foreground">{t('aliases.board.noMatches')}</p>
        )}
      </div>
    </Column>
  );
}

function CanonicalRow({
  item,
  active,
  isOver,
  outcome,
  dragging,
  onClick,
}: {
  item: CanonicalItem;
  active: boolean;
  isOver: boolean;
  outcome: DropOutcome | null;
  dragging: boolean;
  onClick: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { setNodeRef } = useDroppable({ id: `${CANONICAL_PREFIX}${item.name}` });
  const accepts = isOver && outcome && outcome.kind !== 'none';
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid="alias-canonical-item"
      data-name={item.name}
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent',
        active && 'border-primary/60 bg-primary/10 font-medium',
        dragging && !active && 'border-dashed border-border',
        accepts && 'border-primary bg-primary/20 ring-2 ring-primary',
      )}
    >
      <span className="truncate">{item.name}</span>
      {item.siteNames > 0 && (
        <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums">
          {(['iaai', 'copart'] as const).map(
            (source) =>
              item.bySource[source] > 0 && (
                <span
                  key={source}
                  title={`${t(`sources.${source}`)}: ${t('aliases.board.siteNames', { count: item.bySource[source] })}`}
                  className={cn('rounded px-1 py-px font-medium', siteColor(source))}
                >
                  {formatNumber(item.bySource[source], i18n.language)}
                </span>
              ),
          )}
          <span className="text-muted-foreground" title={t('aliases.board.siteNames', { count: item.siteNames })}>
            {formatNumber(item.siteNames, i18n.language)}
          </span>
        </span>
      )}
    </button>
  );
}

function AssignedColumn({
  active,
  entries,
  loading,
  dragging,
  isOver,
  outcome,
  hiddenCount,
  onShowMore,
  children,
}: {
  active: string | null;
  entries: AliasEntry[];
  loading: boolean;
  dragging: boolean;
  isOver: boolean;
  outcome: DropOutcome | null;
  hiddenCount: number;
  onShowMore: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { setNodeRef } = useDroppable({ id: 'assigned' });
  const refused = isOver && outcome?.kind === 'needs-selection';
  const accepts = isOver && !!outcome && outcome.kind !== 'none' && !refused;
  return (
    <Column
      testId="alias-assigned"
      setRef={setNodeRef}
      title={active ? t('aliases.board.assignedTitle', { name: active }) : t('aliases.board.assignedNone')}
      count={active ? entries.length : undefined}
      className={cn(
        dragging && active && 'border-dashed border-primary/50',
        accepts && 'border-solid border-primary bg-primary/10 ring-2 ring-primary',
        refused && 'border-destructive bg-destructive/5',
      )}
    >
      {!active ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <MousePointerClick className="size-8" />
          <p className="max-w-xs">{t('aliases.board.selectHint')}</p>
        </div>
      ) : loading ? (
        <ColumnSkeleton rows={4} />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('aliases.board.assignedEmpty')}</p>
      ) : (
        <>
          <div className="flex flex-wrap content-start gap-1.5">{children}</div>
          {hiddenCount > 0 && <ShowMore hidden={hiddenCount} onClick={onShowMore} />}
        </>
      )}
    </Column>
  );
}

function ShowMore({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  const { t, i18n } = useTranslation();
  return (
    <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={onClick} data-testid="alias-show-more">
      {t('aliases.board.showMore', { count: hidden, hidden: formatNumber(hidden, i18n.language) })}
    </Button>
  );
}

function PoolColumn({
  status,
  total,
  shown,
  onShowMore,
  loading,
  failed,
  dragging,
  isOver,
  outcome,
  selectedCount,
  onIgnoreSelected,
  onClearSelection,
  children,
}: {
  status?: AliasStatus;
  total?: number;
  shown: number;
  /** set when the list holds more names than are rendered */
  onShowMore?: () => void;
  loading: boolean;
  failed: boolean;
  dragging: boolean;
  isOver: boolean;
  outcome: DropOutcome | null;
  selectedCount: number;
  onIgnoreSelected: () => void;
  onClearSelection: () => void;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { setNodeRef } = useDroppable({ id: 'pool' });
  const accepts = isOver && outcome?.kind === 'unassign';
  return (
    <Column
      testId="alias-pool"
      setRef={setNodeRef}
      title={status ? t(`aliases.status.${status}`) : t('aliases.filters.allStatuses')}
      count={total === undefined ? undefined : formatNumber(total, i18n.language)}
      className={cn(dragging && 'border-dashed', accepts && 'border-solid border-amber-500 bg-amber-500/10 ring-2 ring-amber-500')}
      header={
        selectedCount > 0 ? (
          <div className="flex items-center gap-2 text-xs" data-testid="alias-selection">
            <span>{t('aliases.board.selected', { count: selectedCount })}</span>
            <Button size="sm" variant="outline" className="h-7" onClick={onIgnoreSelected}>
              {t('aliases.details.ignore')}
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={onClearSelection}>
              {t('aliases.board.clearSelection')}
            </Button>
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <ColumnSkeleton rows={6} />
      ) : failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t('aliases.requestFailed')}
        </p>
      ) : shown === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="alias-pool-empty">
          {status === 'unassigned' ? t('aliases.board.poolEmptyUnassigned') : t('aliases.board.poolEmpty')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap content-start gap-1.5">{children}</div>
          {onShowMore && <ShowMore hidden={(total ?? shown) - shown} onClick={onShowMore} />}
          {/* everything loaded is on screen, but the server had more */}
          {!onShowMore && total !== undefined && total > shown && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {t('aliases.board.truncated', { shown: formatNumber(shown, i18n.language), total: formatNumber(total, i18n.language) })}
            </p>
          )}
        </>
      )}
    </Column>
  );
}

/** Models tab without a make: pick one, makes with unassigned models first. */
function MakePicker({ source, onPick }: { source?: AuctionSource; onPick: (make: string) => void }) {
  const { t, i18n } = useTranslation();
  const makes = useAliasMakes(source);
  const items = [...(makes.data?.items ?? [])].sort((a, b) => b.unassigned - a.unassigned || a.name.localeCompare(b.name));
  return (
    <Column testId="alias-canonical" title={t('aliases.board.chooseMake')}>
      {makes.isPending && <ColumnSkeleton rows={8} />}
      <div className="flex flex-col gap-1">
        {items.map((m) => (
          <button
            key={m.name}
            type="button"
            onClick={() => onPick(m.name)}
            data-testid="alias-make-pick"
            className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-accent"
          >
            <span className="truncate">{m.name}</span>
            {m.unassigned > 0 && (
              <Badge variant="destructive" className="h-4 px-1.5 text-[10px] tabular-nums">
                {formatNumber(m.unassigned, i18n.language)}
              </Badge>
            )}
          </button>
        ))}
        {!makes.isPending && items.length === 0 && <p className="text-sm text-muted-foreground">{t('aliases.board.noModelMakes')}</p>}
      </div>
    </Column>
  );
}

function ColumnSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}
