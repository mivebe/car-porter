import { useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { parseMoneyInput } from './parse-money';

const display = (cents: number | null) => (cents == null ? '' : String(cents / 100));

interface MoneyInputProps extends Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> {
  valueCents: number | null;
  /** Called on blur / Enter with the parsed value when it changed. */
  onCommit: (cents: number | null) => void;
  currency: 'USD' | 'EUR';
}

/** Free-typing money field that commits on blur/Enter instead of on every keystroke. */
export function MoneyInput({ valueCents, onCommit, currency, className, ...props }: MoneyInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? display(valueCents);
  const parsed = parseMoneyInput(text);

  const commit = () => {
    if (draft === null) return;
    if (parsed !== undefined && parsed !== valueCents) onCommit(parsed);
    setDraft(null);
  };

  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
        {currency === 'USD' ? '$' : '€'}
      </span>
      <Input
        {...props}
        inputMode="decimal"
        className={cn('pl-7 tabular-nums', className)}
        value={text}
        aria-invalid={parsed === undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </div>
  );
}
