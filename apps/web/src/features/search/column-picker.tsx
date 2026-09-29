import { ChevronDown, ChevronUp, Columns3, GripVertical, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { LOCKED_COLUMNS, moveColumn, type LotColumn } from './lot-columns';

interface ColumnPickerProps {
  columns: LotColumn[];
  onChange: (columns: LotColumn[]) => void;
  onReset: () => void;
}

/** Show/hide and reorder the result columns (drag a row, or use the arrows). */
export function ColumnPicker({ columns, onChange, onReset }: ColumnPickerProps) {
  const { t } = useTranslation();
  /** While dragging: the order being dragged into and the dragged row's index in it; saved on drop. */
  const [drag, setDrag] = useState<{ order: LotColumn[]; index: number } | null>(null);
  const shown = drag?.order ?? columns;

  const toggle = (index: number, visible: boolean) =>
    onChange(columns.map((c, i) => (i === index ? { ...c, visible } : c)));
  const endDrag = () => {
    if (drag && drag.order.some((c, i) => c.id !== columns[i]?.id)) onChange(drag.order);
    setDrag(null);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Columns3 />
          {t('search.columns.title')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-(--radix-popover-content-available-height) w-64 overflow-y-auto p-2">
        <ul className="grid gap-0.5" data-testid="column-picker">
          {shown.map((column, index) => {
            const label = t(`search.columns.${column.id}`);
            const locked = LOCKED_COLUMNS.has(column.id);
            return (
              <li
                key={column.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  setDrag({ order: columns, index });
                }}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  if (drag.index !== index) setDrag({ order: moveColumn(drag.order, drag.index, index), index });
                }}
                onDrop={(e) => e.preventDefault()}
                onDragEnd={endDrag}
                className={cn(
                  'flex items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-muted/60',
                  drag?.index === index && 'bg-muted',
                )}
              >
                <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
                <Checkbox
                  id={`column-${column.id}`}
                  checked={column.visible}
                  disabled={locked}
                  onCheckedChange={(v) => toggle(index, v === true)}
                />
                <label htmlFor={`column-${column.id}`} className="flex-1 cursor-pointer select-none">
                  {label}
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={index === 0}
                  aria-label={t('search.columns.moveUp', { column: label })}
                  onClick={() => onChange(moveColumn(columns, index, index - 1))}
                >
                  <ChevronUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={index === shown.length - 1}
                  aria-label={t('search.columns.moveDown', { column: label })}
                  onClick={() => onChange(moveColumn(columns, index, index + 1))}
                >
                  <ChevronDown />
                </Button>
              </li>
            );
          })}
        </ul>
        <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={onReset}>
          <RotateCcw />
          {t('search.columns.reset')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
