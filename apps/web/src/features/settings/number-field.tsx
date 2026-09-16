import { useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { parseNumberInput } from './parse-number';

interface NumberFieldProps {
  id: string;
  label: ReactNode;
  value: number | null;
  /** Receives null for an empty field and NaN for text that isn't a number. */
  onChange: (value: number | null) => void;
  unit?: string;
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
}

/** Free-typing number input; keeps the typed text and reports the parsed value. */
export function NumberField({
  id,
  label,
  value,
  onChange,
  unit,
  placeholder,
  hint,
  error,
  className,
}: NumberFieldProps) {
  const [text, setText] = useState(value == null || Number.isNaN(value) ? '' : String(value));
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          className={cn('tabular-nums', unit && 'pr-12')}
          value={text}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseNumberInput(e.target.value));
          }}
        />
        {unit && (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
