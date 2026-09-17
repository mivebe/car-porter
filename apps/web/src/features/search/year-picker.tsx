import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { MAX_YEAR, MIN_YEAR } from './validate-filters';

interface YearPickerProps {
  id: string;
  ariaLabel: string;
  value: string;
  onChange: (year: string) => void;
  placeholder: string;
  /** years before this one can't be picked */
  min?: number;
  invalid?: boolean;
}

/** A year button opening a grid of years (newest first); a year can also be typed and confirmed with Enter. */
export function YearPicker({ id, ariaLabel, value, onChange, placeholder, min = MIN_YEAR, invalid }: YearPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const max = MAX_YEAR();
  const years = Array.from({ length: max - MIN_YEAR + 1 }, (_, i) => max - i);
  const selected = Number(value);
  const typedYear = Number(typed);
  const typedValid = typed.length === 4 && typedYear >= Math.max(min, MIN_YEAR) && typedYear <= max;

  const pick = (year: number) => {
    onChange(String(year));
    setTyped('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          className="w-full justify-between font-normal tabular-nums"
        >
          <span className={cn(!value && 'text-muted-foreground')}>{value || placeholder}</span>
          <CalendarDays className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <Input
          autoFocus
          inputMode="numeric"
          className="mb-2 h-8 tabular-nums"
          placeholder={t('search.typeYear')}
          aria-label={t('search.typeYear')}
          value={typed}
          aria-invalid={typed.length === 4 && !typedValid}
          onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (typedValid) pick(typedYear);
            }
          }}
        />
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="grid max-h-64 grid-cols-4 gap-1 overflow-y-auto pr-1"
          ref={(el) => {
            // open on the selected year, or the latest years
            el?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
          }}
        >
          {years.map((year) => {
            const disabled = year < min;
            const isSelected = year === selected;
            const matchesTyped = !!typed && String(year).startsWith(typed);
            return (
              <button
                key={year}
                type="button"
                role="option"
                aria-selected={isSelected}
                aria-disabled={disabled}
                disabled={disabled}
                onClick={() => pick(year)}
                className={cn(
                  'rounded-md py-1.5 text-sm tabular-nums transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30',
                  typed && !matchesTyped && 'opacity-40',
                  isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                {year}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
